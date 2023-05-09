import * as kplus from "cdk8s-plus-24";
import { ApiObject, Chart, ChartProps, JsonPatch, Duration, Size } from "cdk8s";
import { Construct } from "constructs";

interface K6BaseChartProps extends ChartProps {
  namespace: string;
}

export class K6BaseChart extends Chart {
  public readonly scenarioVolume: kplus.Volume;
  constructor(scope: Construct, id: string, props: K6BaseChartProps) {
    super(scope, id, props);

    // テストシナリオをConfigMapに格納
    const k6NameSpace = new kplus.Namespace(this, "k6Namespace", { metadata: { name: props.namespace } });
    const k6ScenarioConfig = new kplus.ConfigMap(this, "k6ScenarioConfig");
    k6ScenarioConfig.addFile("./lib/scenario/script.js");

    const kubeK6ScenarioConfig = ApiObject.of(k6ScenarioConfig);
    kubeK6ScenarioConfig.addJsonPatch(JsonPatch.add("/metadata/namespace", k6NameSpace.name));

    // volumeを作成
    this.scenarioVolume = kplus.Volume.fromConfigMap(this, "senarioVolume", k6ScenarioConfig);
  }
}
