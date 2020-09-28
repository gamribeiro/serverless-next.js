import { Component } from "@serverless/core";
import {
  OriginRequestDefaultHandlerManifest as BuildManifest,
  OriginRequestDefaultHandlerManifest,
  OriginRequestApiHandlerManifest
} from "@sls-next/lambda-at-edge/types";
import type { ServerlessComponentInputs } from "../types";
declare type DeploymentResult = {
  appUrl: string;
  bucketName: string;
};
declare class NextjsComponent extends Component {
  default(inputs?: ServerlessComponentInputs): Promise<DeploymentResult>;
  readDefaultBuildManifest(
    nextConfigPath: string
  ): Promise<OriginRequestDefaultHandlerManifest>;
  validatePathPatterns(
    pathPatterns: string[],
    buildManifest: BuildManifest
  ): void;
  readApiBuildManifest(
    nextConfigPath: string
  ): Promise<OriginRequestApiHandlerManifest>;
  build(inputs?: ServerlessComponentInputs): Promise<void>;
  deploy(inputs?: ServerlessComponentInputs): Promise<DeploymentResult>;
  remove(): Promise<void>;
}
export default NextjsComponent;
