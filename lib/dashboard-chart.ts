import * as kplus from "cdk8s-plus-24";
import { KubeClusterRoleBinding } from "../imports/k8s";
import { ApiObject, Chart, ChartProps, Include } from "cdk8s";
import { Construct } from "constructs";

export class DashboardChart extends Chart {
  constructor(scope: Construct, id: string, props?: ChartProps) {
    super(scope, id, props);

    // dashboard install(https://github.com/kubernetes/dashboard)
    const dashboard = new Include(this, "dashboard", {
      url: "https://raw.githubusercontent.com/kubernetes/dashboard/v2.6.1/aio/deploy/recommended.yaml",
    });

    const kubeDashboardNamespace = ApiObject.of(dashboard.apiObjects[0]);
    const dashboardNamespace = kubeDashboardNamespace.metadata.name;

    // サンプルユーザーの作成
    // https://github.com/kubernetes/dashboard/blob/master/docs/user/access-control/creating-sample-user.md
    const userName = "admin-user";
    new kplus.ServiceAccount(this, "dashboardUserSa", {
      metadata: {
        name: userName,
        namespace: dashboardNamespace,
      },
    });

    new KubeClusterRoleBinding(this, "dashboardUserRb", {
      metadata: {
        name: userName,
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "cluster-admin",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: userName,
          namespace: dashboardNamespace,
        },
      ],
    });
  }
}
