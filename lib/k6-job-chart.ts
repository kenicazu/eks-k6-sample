import * as kplus from "cdk8s-plus-24";
import { ApiObject, Chart, ChartProps, JsonPatch, Duration, Size } from "cdk8s";
import { Construct } from "constructs";
import { Cpu, EnvFieldPaths, EnvValue } from "cdk8s-plus-24";

interface K6JobChartProps extends ChartProps {
  namespace: string;
  parallelism: number;
  scenarioVolume: kplus.Volume;
}

export class K6JobChart extends Chart {
  constructor(scope: Construct, id: string, props: K6JobChartProps) {
    super(scope, id, props);

    // jobを作成
    const mountPath = "/var/app";
    // Job実行のためrandom文字列の生成(乱数を32進数へ変換->小数点以下を抜粋)
    const randomString = Math.random().toString(32).substring(2);

    const k6Job = new kplus.Job(this, "k6Job", {
      metadata: {
        name: `k6-job-${randomString}`,
      },
      volumes: [props.scenarioVolume],
      // https://kubernetes.io/ja/docs/concepts/workloads/controllers/job/#ttl-mechanism-for-finished-jobs
      ttlAfterFinished: Duration.seconds(600),
      containers: [
        {
          image: "grafana/k6:latest",
          resources: {
            cpu: { limit: Cpu.millis(250), request: Cpu.millis(250) },
            memory: { limit: Size.mebibytes(256), request: Size.mebibytes(256) },
          },
          args: ["run", "/var/app/script.js", "--out", "statsd"],
          volumeMounts: [{ path: mountPath, volume: props.scenarioVolume }],
          envVariables: {
            K6_STATSD_ENABLE_TAGS: EnvValue.fromValue("true"),
            HOST_IP: EnvValue.fromFieldRef(EnvFieldPaths.NODE_IP),
            K6_STATSD_ADDR: EnvValue.fromValue("$(HOST_IP):8125"),
          },
        },
      ],
    });

    const kubek6Job = ApiObject.of(k6Job);

    // namespaceと並列数追加
    kubek6Job.addJsonPatch(JsonPatch.add("/metadata/namespace", props.namespace));
    // cdk8s+のAPIにparallelismがないので、JsonPatchで追加
    kubek6Job.addJsonPatch(JsonPatch.add("/spec/parallelism", props.parallelism));
  }
}
