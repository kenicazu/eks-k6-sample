import { Policy, PolicyStatement, IRole } from "aws-cdk-lib/aws-iam";
import { CfnJson, Stack } from "aws-cdk-lib";

// Scope fluentbit to push logs to log-group /aws/containerinsights/CLUSTER_NAME/ only
export function createFluentbitPolicy(stack: Stack): Policy {
  const fluentBitSaRoleStatementPolicy = new PolicyStatement({
    resources: ["*"],
    actions: ["logs:CreateLogStream", "logs:CreateLogGroup", "logs:DescribeLogStreams", "logs:PutLogEvents"],
  });
  return new Policy(stack, "fluentBitSaRolePolicy", {
    statements: [fluentBitSaRoleStatementPolicy],
  });
}

export function createAutoscalerPolicy(stack: Stack, clusterName: string): Policy {
  const editAsgRoleCondition = new CfnJson(stack, `AutoscalerCondition`, {
    value: {
      [`aws:ResourceTag/k8s.io/cluster-autoscaler/${clusterName}`]: "owned",
    },
  });

  const editAsgStatementPolicy = new PolicyStatement({
    resources: ["*"],
    actions: ["autoscaling:SetDesiredCapacity", "autoscaling:TerminateInstanceInAutoScalingGroup"],
    conditions: { StringEquals: editAsgRoleCondition },
  });

  const readAsgStatementPolicy = new PolicyStatement({
    resources: ["*"],
    actions: [
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeAutoScalingGroups",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:DescribeInstanceTypes",
      "autoscaling:DescribeTags",
      "autoscaling:DescribeLaunchConfigurations",
    ],
  });

  return new Policy(stack, "autoscalerSaRolePolicy", {
    statements: [editAsgStatementPolicy, readAsgStatementPolicy],
  });
}
