import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface EksManagedNodeGroupProps {
  cluster: eks.Cluster;
}

export class EksManagedNodeGroup extends Construct {
  constructor(scope: Construct, id: string, props: EksManagedNodeGroupProps) {
    super(scope, id);

    const lt = new ec2.LaunchTemplate(this, "EksNodeLaunchTemplate", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MEDIUM),
    });

    const nodeRole = new iam.Role(this, "EksNodeRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    nodeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"));
    nodeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"));
    nodeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    nodeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"));

    props.cluster.addNodegroupCapacity("NGCapacity", {
      launchTemplateSpec: {
        id: lt.launchTemplateId!,
        version: lt.latestVersionNumber,
      },
      minSize: 1,
      maxSize: 10,
      amiType: eks.NodegroupAmiType.AL2_X86_64,
      nodeRole: nodeRole,
    });
  }
}
