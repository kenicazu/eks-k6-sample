import { ApiObject, Chart, ChartProps, Include, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { Environment } from "aws-cdk-lib";

interface ClusterAutoscalerChartProps extends ChartProps {
  eksClusterName: string;
  env: Environment;
  clusterAutoscalerPodRoleName: string;
}

export class ClusterAutoscalerChart extends Chart {
  public readonly clusterAutoscalerSaName: string;
  public readonly namespace: string;
  constructor(scope: Construct, id: string, props: ClusterAutoscalerChartProps) {
    super(scope, id, props);

    this.namespace = "kube-system";

    // https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml#L163
    const clusterAutoscaler = new Include(this, "autoscaler", {
      url: "https://raw.githubusercontent.com/kubernetes/autoscaler/master/cluster-autoscaler/cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml",
    });

    // specify autoscaler Deployment manifest
    const kubeClusterAutoscalerDeployment = ApiObject.of(clusterAutoscaler.apiObjects[5]);

    kubeClusterAutoscalerDeployment.addJsonPatch(
      JsonPatch.replace(
        "/spec/template/spec/containers/0/command/6",
        `--node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/${props.eksClusterName}`
      )
    );

    kubeClusterAutoscalerDeployment.addJsonPatch(JsonPatch.add("/spec/template/spec/containers/0/command/-", "--balance-similar-node-groups"));
    kubeClusterAutoscalerDeployment.addJsonPatch(JsonPatch.add("/spec/template/spec/containers/0/command/-", "--skip-nodes-with-system-pods=false"));
    kubeClusterAutoscalerDeployment.addJsonPatch(JsonPatch.add("/spec/template/spec/containers/0/command/-", "--scale-down-delay-after-add=1m"));
    kubeClusterAutoscalerDeployment.addJsonPatch(JsonPatch.add("/spec/template/spec/containers/0/command/-", "--scale-down-unneeded-time=1m"));

    kubeClusterAutoscalerDeployment.addJsonPatch(
      JsonPatch.replace("/spec/template/spec/containers/0/image", "k8s.gcr.io/autoscaling/cluster-autoscaler:v1.24.0")
    );

    kubeClusterAutoscalerDeployment.addJsonPatch(JsonPatch.add("/spec/template/metadata/annotations/cluster-autoscaler.kubernetes.io~1safe-to-evict", "false"));

    // annotate service account
    const kubeClusterAutoscalerSa = ApiObject.of(clusterAutoscaler.apiObjects[0]);
    this.clusterAutoscalerSaName = kubeClusterAutoscalerSa.name;

    kubeClusterAutoscalerSa.addJsonPatch(
      JsonPatch.add("/metadata/annotations", {
        "eks.amazonaws.com/role-arn": `arn:aws:iam::${props.env.account}:role/${props.clusterAutoscalerPodRoleName}`,
      })
    );
  }
}
