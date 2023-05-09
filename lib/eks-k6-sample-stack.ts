import * as cdk from "aws-cdk-lib";
import * as cdk8s from "cdk8s";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";
import { IpAddresses } from "aws-cdk-lib/aws-ec2";
import { KubectlV24Layer } from "@aws-cdk/lambda-layer-kubectl-v24";
import { K6JobChart } from "./k6-job-chart";
import { K6BaseChart } from "./k6-base-chart";
import { MonitoringChart } from "./monitoring-chart";
import { CfnJson } from "aws-cdk-lib";
import { createAutoscalerPolicy, createFluentbitPolicy } from "./policies/policies";
import { ClusterAutoscalerChart } from "./cluster-autoscaler-chart";
import { EksManagedNodeGroup } from "./constructs/eks-mng";
import { DashboardChart } from "./dashboard-chart";

interface PodRoleFuncParam {
  iamOidc: iam.IOpenIdConnectProvider;
  namespace: string;
  saName: string;
  podRoleName: string;
}

interface EksK6SampleStackProps extends cdk.StackProps {
  currentIamArn: string;
}

export class EksK6SampleStack extends cdk.Stack {
  public readonly cdk8sApp: cdk8s.App;
  constructor(scope: Construct, id: string, props: EksK6SampleStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "SampleVpc", {
      ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const iamRole = new iam.Role(this, "EksAdminRole", {
      roleName: `${id}-iam`,
      assumedBy: new iam.ArnPrincipal(props.currentIamArn),
    });

    const kubectl = new KubectlV24Layer(this, "KubectlLayer");

    const eksCluster = new eks.Cluster(this, "EksCluster", {
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      version: eks.KubernetesVersion.V1_24,
      kubectlLayer: kubectl,
      mastersRole: iamRole,
      defaultCapacity: 0,
    });

    new EksManagedNodeGroup(this, "EksManagedNodeGroup", { cluster: eksCluster });

    // IdP for IAM Roles for Service Accounts
    // https://aws.amazon.com/jp/blogs/news/diving-into-iam-roles-for-service-accounts/
    const iamOidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "EksOidcProvider", eksCluster.openIdConnectProvider.openIdConnectProviderArn);

    this.cdk8sApp = new cdk8s.App();

    // define IAM Role name for Pods
    const fluentBitPodRoleName = `${id}FluentBitPodRole`;
    const cloudwatchPodRoleName = `${id}CloudwatchPodRole`;
    const clusterAutoscalerPodRoleName = `${id}AmazonEKSClusterAutoscalerRole`;

    // define cdk8s chart
    const monitoringChart = new MonitoringChart(this.cdk8sApp, "monitoringChart", {
      eksClusterName: eksCluster.clusterName,
      env: props.env!,
      fluentBitPodRoleName,
      cloudwatchPodRoleName,
    });

    const clusterAutoscalerChart = new ClusterAutoscalerChart(this.cdk8sApp, "clusterAutoscalerChart", {
      eksClusterName: eksCluster.clusterName,
      env: props.env!,
      clusterAutoscalerPodRoleName,
    });

    const k6Namespace = "k6";
    const k6BaseChart = new K6BaseChart(this.cdk8sApp, "k6Base", { namespace: k6Namespace });

    // Create IAM Role for Pods
    const fluentBitPodRole = this.createPodRole({
      iamOidc: iamOidc,
      saName: monitoringChart.fluentBitSaName,
      podRoleName: fluentBitPodRoleName,
      namespace: monitoringChart.namespace!,
    });

    const cloudwatchAgentRole = this.createPodRole({
      iamOidc: iamOidc,
      saName: monitoringChart.cloudwatchSaName,
      podRoleName: cloudwatchPodRoleName,
      namespace: monitoringChart.namespace!,
    });

    const clusterAutoscalerPodRole = this.createPodRole({
      iamOidc: iamOidc,
      saName: clusterAutoscalerChart.clusterAutoscalerSaName,
      podRoleName: clusterAutoscalerPodRoleName,
      namespace: clusterAutoscalerChart.namespace,
    });

    // Attatch Policy to IAM Role
    cloudwatchAgentRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"));

    const fluentBitSaRolePolicy = createFluentbitPolicy(this);
    fluentBitPodRole.attachInlinePolicy(fluentBitSaRolePolicy);

    const autoscalerSaRolePolicy = createAutoscalerPolicy(this, eksCluster.clusterName);
    clusterAutoscalerPodRole.attachInlinePolicy(autoscalerSaRolePolicy);

    // add cdk8s chart to eks cluster
    eksCluster.addCdk8sChart("fluentBitMonitoring", monitoringChart);

    eksCluster.addCdk8sChart("clusterAutoscaler", clusterAutoscalerChart);

    const k6Flag = this.node.tryGetContext("k6") === "true";
    const parallelism: number = Number(this.node.tryGetContext("parallelism"));

    eksCluster.addCdk8sChart("k6BaseChart", k6BaseChart);

    if (k6Flag) {
      const k6Namespace = "k6";
      eksCluster.addCdk8sChart(
        "k6JobChart",
        new K6JobChart(this.cdk8sApp, "k6Job", { namespace: k6Namespace, parallelism: parallelism, scenarioVolume: k6BaseChart.scenarioVolume })
      );
    }

    eksCluster.addCdk8sChart("dashboardChart", new DashboardChart(this.cdk8sApp, "dashboard"));
  }

  // Function to create empty IAM Role for Pod
  createPodRole(param: PodRoleFuncParam): iam.Role {
    const podRoleCondition = new CfnJson(this, `${param.podRoleName}Condition`, {
      value: {
        [`${param.iamOidc.openIdConnectProviderIssuer}:sub`]: `system:serviceaccount:${param.namespace}:${param.saName}`,
      },
    });

    const podRole = new iam.Role(this, `${param.podRoleName}`, {
      roleName: param.podRoleName,
      assumedBy: new iam.OpenIdConnectPrincipal(param.iamOidc, {
        StringEquals: podRoleCondition,
      }),
    });

    return podRole;
  }
}
