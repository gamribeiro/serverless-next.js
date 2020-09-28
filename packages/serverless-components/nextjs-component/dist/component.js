"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@serverless/core");
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const lambda_at_edge_1 = require("@sls-next/lambda-at-edge");
const s3_static_assets_1 = __importDefault(
  require("@sls-next/s3-static-assets")
);
const cloudfront_1 = __importDefault(require("@sls-next/cloudfront"));
const obtainDomains_1 = __importDefault(require("./lib/obtainDomains"));
const constants_1 = require("./constants");
class NextjsComponent extends core_1.Component {
  default(inputs = {}) {
    return __awaiter(this, void 0, void 0, function* () {
      if (inputs.build !== false) {
        yield this.build(inputs);
      }
      return this.deploy(inputs);
    });
  }
  readDefaultBuildManifest(nextConfigPath) {
    return fs_extra_1.readJSON(
      path_1.join(
        nextConfigPath,
        ".serverless_nextjs/default-lambda/manifest.json"
      )
    );
  }
  validatePathPatterns(pathPatterns, buildManifest) {
    const stillToMatch = new Set(pathPatterns);
    if (stillToMatch.size !== pathPatterns.length) {
      throw Error("Duplicate path declared in cloudfront configuration");
    }
    stillToMatch.delete("api/*");
    stillToMatch.delete("static/*");
    stillToMatch.delete("_next/static/*");
    for (const path of stillToMatch) {
      if (/^(\/?api\/.*|\/?api)$/.test(path)) {
        throw Error(
          `Setting custom cache behaviour for api/ route "${path}" is not supported`
        );
      }
    }
    const manifestRegex = [];
    const manifestPaths = new Set();
    const ssrDynamic = buildManifest.pages.ssr.dynamic || {};
    const ssrNonDynamic = buildManifest.pages.ssr.nonDynamic || {};
    const htmlDynamic = buildManifest.pages.html.dynamic || {};
    const htmlNonDynamic = buildManifest.pages.html.nonDynamic || {};
    Object.entries(
      Object.assign(Object.assign({}, ssrDynamic), htmlDynamic)
    ).map(([, { regex }]) => {
      manifestRegex.push(new RegExp(regex));
    });
    Object.entries(
      Object.assign(Object.assign({}, ssrNonDynamic), htmlNonDynamic)
    ).map(([path]) => {
      manifestPaths.add(path);
    });
    manifestRegex.forEach((re) => {
      for (const path of stillToMatch) {
        if (re.test(path)) {
          stillToMatch.delete(path);
        }
      }
    });
    for (const pathToMatch of stillToMatch) {
      for (const path of manifestPaths) {
        if (new RegExp(pathToMatch).test(path)) {
          stillToMatch.delete(pathToMatch);
        }
      }
    }
    if (stillToMatch.size > 0) {
      throw Error(
        `CloudFront input failed validation. Could not find next.js pages for "${[
          ...stillToMatch
        ]}"`
      );
    }
  }
  readApiBuildManifest(nextConfigPath) {
    return __awaiter(this, void 0, void 0, function* () {
      const path = path_1.join(
        nextConfigPath,
        ".serverless_nextjs/api-lambda/manifest.json"
      );
      return (yield fs_extra_1.pathExists(path))
        ? fs_extra_1.readJSON(path)
        : Promise.resolve(undefined);
    });
  }
  build(inputs = {}) {
    return __awaiter(this, void 0, void 0, function* () {
      const nextConfigPath = inputs.nextConfigDir
        ? path_1.resolve(inputs.nextConfigDir)
        : process.cwd();
      const buildCwd =
        typeof inputs.build === "boolean" ||
        typeof inputs.build === "undefined" ||
        !inputs.build.cwd
          ? nextConfigPath
          : path_1.resolve(inputs.build.cwd);
      const buildConfig = Object.assign(
        Object.assign(
          {
            enabled: inputs.build
              ? inputs.build !== false && inputs.build.enabled !== false
              : true,
            cmd: "node_modules/.bin/next",
            args: ["build"]
          },
          typeof inputs.build === "object" ? inputs.build : {}
        ),
        { cwd: buildCwd }
      );
      if (buildConfig.enabled) {
        const builder = new lambda_at_edge_1.Builder(
          nextConfigPath,
          path_1.join(nextConfigPath, ".serverless_nextjs"),
          {
            cmd: buildConfig.cmd,
            cwd: buildConfig.cwd,
            env: buildConfig.env,
            args: buildConfig.args,
            useServerlessTraceTarget: inputs.useServerlessTraceTarget || false
          }
        );
        yield builder.build(this.context.instance.debugMode);
      }
    });
  }
  deploy(inputs = {}) {
    return __awaiter(this, void 0, void 0, function* () {
      const nextConfigPath = inputs.nextConfigDir
        ? path_1.resolve(inputs.nextConfigDir)
        : process.cwd();
      const nextStaticPath = inputs.nextStaticDir
        ? path_1.resolve(inputs.nextStaticDir)
        : nextConfigPath;
      const customCloudFrontConfig = inputs.cloudfront || {};
      const bucketRegion = inputs.bucketRegion || "us-east-1";
      const [defaultBuildManifest, apiBuildManifest] = yield Promise.all([
        this.readDefaultBuildManifest(nextConfigPath),
        this.readApiBuildManifest(nextConfigPath)
      ]);
      const [
        bucket,
        cloudFront,
        defaultEdgeLambda,
        apiEdgeLambda
      ] = yield Promise.all([
        this.load("@serverless/aws-s3"),
        this.load("@sls-next/aws-cloudfront"),
        this.load("@sls-next/aws-lambda", "defaultEdgeLambda"),
        this.load("@sls-next/aws-lambda", "apiEdgeLambda")
      ]);
      const bucketOutputs = yield bucket({
        accelerated: false,
        name: inputs.bucketName,
        region: bucketRegion
      });
      yield s3_static_assets_1.default({
        bucketName: bucketOutputs.name,
        nextConfigDir: nextConfigPath,
        nextStaticDir: nextStaticPath,
        credentials: this.context.credentials.aws,
        publicDirectoryCache: inputs.publicDirectoryCache
      });
      const bucketUrl = `http://${bucketOutputs.name}.s3.${bucketRegion}.amazonaws.com`;
      const expandRelativeUrls = (origin) => {
        const originUrl = typeof origin === "string" ? origin : origin.url;
        const fullOriginUrl =
          originUrl.charAt(0) === "/" ? `${bucketUrl}${originUrl}` : originUrl;
        if (typeof origin === "string") {
          return fullOriginUrl;
        } else {
          return Object.assign(Object.assign({}, origin), {
            url: fullOriginUrl
          });
        }
      };
      let inputOrigins = [];
      if (inputs.cloudfront && inputs.cloudfront.origins) {
        const origins = inputs.cloudfront.origins;
        inputOrigins = origins.map(expandRelativeUrls);
        delete inputs.cloudfront.origins;
      }
      const cloudFrontOrigins = [
        {
          url: bucketUrl,
          private: true,
          pathPatterns: {
            "_next/static/*": {
              ttl: 86400,
              forward: {
                headers: "none",
                cookies: "none",
                queryString: false
              }
            },
            "static/*": {
              ttl: 86400,
              forward: {
                headers: "none",
                cookies: "none",
                queryString: false
              }
            }
          }
        },
        ...inputOrigins
      ];
      const hasAPIPages =
        apiBuildManifest &&
        (Object.keys(apiBuildManifest.apis.nonDynamic).length > 0 ||
          Object.keys(apiBuildManifest.apis.dynamic).length > 0);
      const readLambdaInputValue = (inputKey, lambdaType, defaultValue) => {
        const inputValue = inputs[inputKey];
        if (typeof inputValue === "string" || typeof inputValue === "number") {
          return inputValue;
        }
        if (!inputValue) {
          return defaultValue;
        }
        return inputValue[lambdaType] || defaultValue;
      };
      if (hasAPIPages) {
        const apiEdgeLambdaInput = {
          description: inputs.description
            ? `${inputs.description} (API)`
            : "API Lambda@Edge for Next CloudFront distribution",
          handler: "index.handler",
          code: path_1.join(nextConfigPath, constants_1.API_LAMBDA_CODE_DIR),
          role: {
            service: ["lambda.amazonaws.com", "edgelambda.amazonaws.com"],
            policy: {
              arn:
                inputs.policy ||
                "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
            }
          },
          memory: readLambdaInputValue("memory", "apiLambda", 512),
          timeout: readLambdaInputValue("timeout", "apiLambda", 10),
          runtime: readLambdaInputValue("runtime", "apiLambda", "nodejs12.x"),
          name: readLambdaInputValue("name", "apiLambda", undefined)
        };
        const apiEdgeLambdaOutputs = yield apiEdgeLambda(apiEdgeLambdaInput);
        const apiEdgeLambdaPublishOutputs = yield apiEdgeLambda.publishVersion();
        cloudFrontOrigins[0].pathPatterns["api/*"] = {
          ttl: 0,
          allowedHttpMethods: [
            "HEAD",
            "DELETE",
            "POST",
            "GET",
            "OPTIONS",
            "PUT",
            "PATCH"
          ],
          "lambda@edge": {
            "origin-request": `${apiEdgeLambdaOutputs.arn}:${apiEdgeLambdaPublishOutputs.version}`
          }
        };
      }
      const defaultEdgeLambdaInput = {
        description:
          inputs.description ||
          "Default Lambda@Edge for Next CloudFront distribution",
        handler: "index.handler",
        code: path_1.join(nextConfigPath, constants_1.DEFAULT_LAMBDA_CODE_DIR),
        role: {
          service: ["lambda.amazonaws.com", "edgelambda.amazonaws.com"],
          policy: {
            arn:
              inputs.policy ||
              "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          }
        },
        memory: readLambdaInputValue("memory", "defaultLambda", 512),
        timeout: readLambdaInputValue("timeout", "defaultLambda", 10),
        runtime: readLambdaInputValue("runtime", "defaultLambda", "nodejs12.x"),
        name: readLambdaInputValue("name", "defaultLambda", undefined)
      };
      const defaultEdgeLambdaOutputs = yield defaultEdgeLambda(
        defaultEdgeLambdaInput
      );
      const defaultEdgeLambdaPublishOutputs = yield defaultEdgeLambda.publishVersion();
      let defaultCloudfrontInputs;
      if (inputs.cloudfront && inputs.cloudfront.defaults) {
        defaultCloudfrontInputs = inputs.cloudfront.defaults;
        delete inputs.cloudfront.defaults;
      } else {
        defaultCloudfrontInputs = {};
      }
      this.validatePathPatterns(
        Object.keys(customCloudFrontConfig),
        defaultBuildManifest
      );
      Object.entries(customCloudFrontConfig).map(([path, config]) => {
        const edgeConfig = Object.assign({}, config["lambda@edge"] || {});
        if (path === "api/*") {
          delete edgeConfig["origin-request"];
        } else if (!["static/*", "_next/*"].includes(path)) {
          edgeConfig[
            "origin-request"
          ] = `${defaultEdgeLambdaOutputs.arn}:${defaultEdgeLambdaPublishOutputs.version}`;
        }
        cloudFrontOrigins[0].pathPatterns[path] = Object.assign(
          Object.assign(
            Object.assign({}, cloudFrontOrigins[0].pathPatterns[path]),
            config
          ),
          {
            "lambda@edge": Object.assign(
              Object.assign(
                {},
                cloudFrontOrigins[0].pathPatterns[path] &&
                  cloudFrontOrigins[0].pathPatterns[path]["lambda@edge"]
              ),
              edgeConfig
            )
          }
        );
      });
      cloudFrontOrigins[0].pathPatterns["_next/data/*"] = {
        ttl: 0,
        allowedHttpMethods: ["HEAD", "GET"],
        "lambda@edge": {
          "origin-request": `${defaultEdgeLambdaOutputs.arn}:${defaultEdgeLambdaPublishOutputs.version}`
        }
      };
      const defaultLambdaAtEdgeConfig = Object.assign(
        {},
        defaultCloudfrontInputs["lambda@edge"] || {}
      );
      delete defaultLambdaAtEdgeConfig["origin-response"];
      const cloudFrontOutputs = yield cloudFront({
        defaults: Object.assign(
          Object.assign({ ttl: 0 }, defaultCloudfrontInputs),
          {
            forward: Object.assign(
              { cookies: "all", queryString: true },
              defaultCloudfrontInputs.forward
            ),
            allowedHttpMethods: ["HEAD", "GET"],
            "lambda@edge": Object.assign(
              Object.assign({}, defaultLambdaAtEdgeConfig),
              {
                "origin-request": `${defaultEdgeLambdaOutputs.arn}:${defaultEdgeLambdaPublishOutputs.version}`
              }
            ),
            compress: true
          }
        ),
        origins: cloudFrontOrigins
      });
      let appUrl = cloudFrontOutputs.url;
      yield cloudfront_1.default({
        distributionId: cloudFrontOutputs.id,
        credentials: this.context.credentials.aws
      });
      const { domain, subdomain } = obtainDomains_1.default(inputs.domain);
      if (domain && subdomain) {
        const domainComponent = yield this.load("@sls-next/domain");
        const domainOutputs = yield domainComponent({
          privateZone: false,
          domain,
          subdomains: {
            [subdomain]: cloudFrontOutputs
          },
          domainType: inputs.domainType || "both",
          defaultCloudfrontInputs
        });
        appUrl = domainOutputs.domains[0];
      }
      return {
        appUrl,
        bucketName: bucketOutputs.name
      };
    });
  }
  remove() {
    return __awaiter(this, void 0, void 0, function* () {
      const [bucket, cloudfront, domain] = yield Promise.all([
        this.load("@serverless/aws-s3"),
        this.load("@sls-next/aws-cloudfront"),
        this.load("@sls-next/domain")
      ]);
      yield Promise.all([
        bucket.remove(),
        cloudfront.remove(),
        domain.remove()
      ]);
    });
  }
}
exports.default = NextjsComponent;
