import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { CfnOutput, Duration } from "aws-cdk-lib";

export class DummySystemStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "HandsonVPC", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "isolatedSubnet",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const engine = rds.DatabaseClusterEngine.auroraMysql({
      version: rds.AuroraMysqlEngineVersion.VER_3_02_1,
    });

    const databaseName = "wordpress";

    const dbCluster = new rds.DatabaseCluster(this, "AuroraCluster", {
      engine: engine,
      defaultDatabaseName: databaseName,
      instanceProps: {
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      },
    });

    const cluster = new ecs.Cluster(this, "WordPressCluster", {
      vpc: vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "WordPressTask", {
      memoryLimitMiB: 512,
    });

    taskDefinition.addContainer("EcsWordPress", {
      image: ecs.ContainerImage.fromRegistry("wordpress:latest"),
      portMappings: [{ containerPort: 80 }],
      secrets: {
        WORDPRESS_DB_HOST: ecs.Secret.fromSecretsManager(dbCluster.secret!, "host"),
        WORDPRESS_DB_NAME: ecs.Secret.fromSecretsManager(dbCluster.secret!, "dbname"),
        WORDPRESS_DB_USER: ecs.Secret.fromSecretsManager(dbCluster.secret!, "username"),
        WORDPRESS_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCluster.secret!, "password"),
      },
    });

    dbCluster.secret?.grantRead(taskDefinition.taskRole);

    const ecsService = new ecs.FargateService(this, "FargateService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      assignPublicIp: true,
      desiredCount: 2,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Security Group for ALB
    const sgForAlb = new ec2.SecurityGroup(this, "sg-for-alb", {
      vpc: vpc,
      allowAllOutbound: true,
    });
    sgForAlb.connections.allowFromAnyIpv4(ec2.Port.tcp(80), "Allow inbound HTTP");

    // ALBを追加
    const alb = new elbv2.ApplicationLoadBalancer(this, "alb", {
      loadBalancerName: `wordpress-alb`,
      vpc: vpc,
      internetFacing: true,
      securityGroup: sgForAlb,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
    });

    const listener = alb.addListener("Listener", {
      port: 80,
    });

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc: vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/wp-includes/images/blank.gif",
        interval: Duration.seconds(60),
        healthyHttpCodes: "200",
      },
    });

    listener.addTargetGroups("ListnerTargetGroup", {
      targetGroups: [targetGroup],
    });

    // ECSをALBのターゲットへ追加
    ecsService.attachToApplicationTargetGroup(targetGroup);

    // データベースのセキュリティグループをECSからのアクセスを受け付けるよう変更
    ecsService.connections.allowTo(dbCluster.connections, ec2.Port.tcp(3306));

    // AutoScaling
    const scaling = ecsService.autoScaleTaskCount({ maxCapacity: 20 });
    scaling.scaleOnRequestCount("RequestScaling", {
      requestsPerTarget: 50,
      targetGroup: targetGroup,
      scaleInCooldown: Duration.seconds(30),
    });

    new CfnOutput(this, "AlbDnsName", { value: `http://${alb.loadBalancerDnsName}` });
  }
}
