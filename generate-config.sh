cat << EOF > ./account-config.ts
import { Environment } from "aws-cdk-lib";

const env: Environment = {
  region: "<Enter region name>",
  account: "<Enter account id>",
};

const currentIamArn: string = "<Enter your current credentials arn>";

export const accountConfig = {
  env,
  currentIamArn,
};
EOF
