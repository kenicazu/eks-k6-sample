import * as kplus from "cdk8s-plus-24";
import { ApiObject, Chart, ChartProps, Include, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { Environment } from "aws-cdk-lib";

interface MonitoringChartProps extends ChartProps {
  eksClusterName: string;
  env: Environment;
  fluentBitPodRoleName: string;
  cloudwatchPodRoleName: string;
}

export class MonitoringChart extends Chart {
  public readonly cloudwatchSaName: string;
  public readonly fluentBitSaName: string;
  public readonly namespace?: string | undefined;
  constructor(scope: Construct, id: string, props: MonitoringChartProps) {
    super(scope, id, props);

    this.namespace = "amazon-cloudwatch";

    // namespaces
    new Include(this, "fluentBitNs", {
      url: "https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/cloudwatch-namespace.yaml",
    });

    // 以下のドキュメントをベースにFluent Bitを設定
    // https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/monitoring/Container-Insights-setup-logs-FluentBit.html

    const fluentBitConfg = new kplus.ConfigMap(this, "fluentBitConfig", {
      data: {
        "cluster.name": `${props.eksClusterName}`,
        "http.port": "2020",
        "http.server": "On",
        "logs.region": `${props.env.region}`,
        "read.head": "Off",
        "read.tail": "On",
      },
    });

    const kubeFluentBitConfig = ApiObject.of(fluentBitConfg);
    kubeFluentBitConfig.addJsonPatch(JsonPatch.add("/metadata/namespace", this.namespace));
    kubeFluentBitConfig.addJsonPatch(JsonPatch.add("/metadata/name", "fluent-bit-cluster-info"));

    const fluentBitDs = new Include(this, "fluentBitDs", {
      url: "https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/fluent-bit/fluent-bit.yaml",
    });

    const kubeFluentBitDsSa = ApiObject.of(fluentBitDs.apiObjects[0]);

    kubeFluentBitDsSa.addJsonPatch(
      JsonPatch.add("/metadata/annotations", { "eks.amazonaws.com/role-arn": `arn:aws:iam::${props.env.account}:role/${props.fluentBitPodRoleName}` })
    );

    this.fluentBitSaName = kubeFluentBitDsSa.name;

    // StatsDを利用したクラスターメトリクス収集の設定
    // https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/monitoring/Container-Insights-setup-metrics.html
    // https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-custom-metrics-statsd.html

    // Service Accountの作成
    const cloudwatchAgentSa = new Include(this, "cloudwatchAgentSa", {
      url: "https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/cwagent/cwagent-serviceaccount.yaml",
    });

    const kubeCloudwatchAgentSa = ApiObject.of(cloudwatchAgentSa.apiObjects[0]);
    kubeCloudwatchAgentSa.addJsonPatch(
      JsonPatch.add("/metadata/annotations", { "eks.amazonaws.com/role-arn": `arn:aws:iam::${props.env.account}:role/${props.cloudwatchPodRoleName}` })
    );

    this.cloudwatchSaName = kubeCloudwatchAgentSa.name;

    // ConfigMap
    const cloudwatchAgentConfg = new kplus.ConfigMap(this, "cloudwatchConfig");

    cloudwatchAgentConfg.addFile("./lib/config/cwagentconfig.json");

    const kubeCloudwatchAgentConfig = ApiObject.of(cloudwatchAgentConfg);
    kubeCloudwatchAgentConfig.addJsonPatch(JsonPatch.add("/metadata/namespace", this.namespace));
    kubeCloudwatchAgentConfig.addJsonPatch(JsonPatch.add("/metadata/name", "cwagentconfig"));

    const cloudwatchAgentDs = new Include(this, "cloudwatchAgentDs", {
      url: "https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/cwagent/cwagent-daemonset.yaml",
    });

    // Podからの通信を受け付けるためPort開放
    const kubeCloudwatchAgentDs = ApiObject.of(cloudwatchAgentDs.apiObjects[0]);
    kubeCloudwatchAgentDs.addJsonPatch(JsonPatch.add("/spec/template/spec/containers/0/ports", [{ containerPort: 8125, hostPort: 8125, protocol: "UDP" }]));
  }
}
