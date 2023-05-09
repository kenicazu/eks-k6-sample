#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EksK6SampleStack } from "../lib/eks-k6-sample-stack";
import { accountConfig } from "../account-config";
import { DummySystemStack } from "../lib/dummy-stack";

const app = new cdk.App();

// dummy stackの定義。サンプルのWordPressサイトを作成します。
new DummySystemStack(app, "DummySystemStack");

// EKSクラスターを作成し、k6のKubernetes Jobを動作させます。
const eksK6SampleStack = new EksK6SampleStack(app, "EksK6SampleStack", {
  ...accountConfig,
});

// cdk8sで生成されたKubernetesのマニフェストを確認するため、以下を定義。
eksK6SampleStack.cdk8sApp.synth();
