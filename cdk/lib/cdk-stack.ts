import cdk = require("@aws-cdk/core");
import ec2 = require("@aws-cdk/aws-ec2");
import rds = require("@aws-cdk/aws-rds");
import appsync = require("@aws-cdk/aws-appsync");
import iam = require("@aws-cdk/aws-iam");
import lambda = require("@aws-cdk/aws-lambda");
import path = require("path");
import fs = require("fs");

const proj = "Temp4";
const clusterName = "TmpCluster4";

export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, `${proj}Vpc`, {
      cidr: "10.100.0.0/16",
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name: "isolated",
          subnetType: ec2.SubnetType.ISOLATED
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE
        }
      ],
      vpnGateway: false
    });

    const secret = new rds.DatabaseSecret(this, "MasterUserSecret", {
      username: "root"
    });

    const securityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      allowAllOutbound: true,
      description: `DB Cluster (${clusterName}) security group`,
      vpc: vpc
    });

    securityGroup.addIngressRule(securityGroup, ec2.Port.allTraffic());
    const cluster = new rds.CfnDBCluster(this, "DatabaseCluster", {
      engine: "aurora",
      engineMode: "serverless",
      engineVersion: "5.6",
      databaseName: clusterName,

      dbClusterIdentifier: clusterName,

      masterUsername: "root",
      masterUserPassword: "password",

      dbSubnetGroupName: new rds.CfnDBSubnetGroup(this, "db-subnet-group", {
        dbSubnetGroupDescription: `${clusterName} database cluster subnet group`,
        subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE })
          .subnetIds
      }).ref,

      vpcSecurityGroupIds: [ securityGroup.securityGroupId ],

      storageEncrypted: true,

      // Maximum here is 35 days
      backupRetentionPeriod: 35,

      scalingConfiguration: {
        autoPause: true,
        secondsUntilAutoPause: 300,
        minCapacity: 1,
        maxCapacity: 32
      }
    });
    cluster.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY, {
      applyToUpdateReplacePolicy: true
    });

    const api = new appsync.CfnGraphQLApi(this, `${proj}PublicAPI`, {
      authenticationType: "API_KEY",
      name: `${proj}PublicAPI`
    });
    const rdsPolicyDocument = new iam.PolicyDocument();
    const rdsPolicyStatement1 = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW
    });
    rdsPolicyStatement1.addActions(
      "rds-data:ExecuteStatement",
      "rds-data:DeleteItems",
      "rds-data:ExecuteSql",
      "rds-data:GetItems",
      "rds-data:InsertItems",
      "rds-data:UpdateItems"
    );
    rdsPolicyStatement1.addResources(
      "arn:aws:rds:us-east-1:456500572160:cluster:" + cluster.ref,
      "arn:aws:rds:us-east-1:456500572160:cluster:" + cluster.ref + ":*"
    );
    const rdsPolicyStatement2 = new iam.PolicyStatement();
    rdsPolicyStatement2.addActions("secretsmanager:GetSecretValue");
    rdsPolicyStatement2.addResources(secret.secretArn, secret.secretArn + ":*");
    rdsPolicyDocument.addStatements(rdsPolicyStatement1);
    rdsPolicyDocument.addStatements(rdsPolicyStatement2);

    const rdsRole = new iam.Role(this, `${proj}RoleAppsyncDS`, {
      assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
      inlinePolicies: { rdsPolicyDocument }
    });
    const rdsDs = new appsync.CfnDataSource(this, `${proj}RdsDs`, {
      apiId: api.attrApiId,
      name: `${proj}RdsDs`,
      type: "RELATIONAL_DATABASE",
      relationalDatabaseConfig: {
        relationalDatabaseSourceType: "RDS_HTTP_ENDPOINT",
        rdsHttpEndpointConfig: {
          awsRegion: "us-east-1",
          awsSecretStoreArn: secret.secretArn,
          databaseName: clusterName,
          dbClusterIdentifier:
            "arn:aws:rds:us-east-1:456500572160:cluster:" + clusterName,
          schema: "mysql"
        }
      },
      serviceRoleArn: rdsRole.roleArn
    });

    const fn = new lambda.Function(this, `${proj}Function`, {
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: "app.lambdaHandler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../assets/lambda/typeorm/fn")
      ),
      environment: {
        host: cluster.attrEndpointAddress,
        port: cluster.attrEndpointPort,
        username: "root",
        password: "password",
        database: clusterName
      },
      timeout: cdk.Duration.seconds(15),
      memorySize: 200,
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE }),
      securityGroup: securityGroup
    });
    const lambdaPolicyDocument = new iam.PolicyDocument();
    const lambdaPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW
    });
    lambdaPolicyStatement.addResources(fn.functionArn, fn.functionArn + ":*");
    lambdaPolicyStatement.addActions("lambda:invokeFunction");
    lambdaPolicyDocument.addStatements(lambdaPolicyStatement);
    const lambdaRole = new iam.Role(this, `${proj}LambdaRole`, {
      assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
      inlinePolicies: { lambdaPolicyDocument }
    });

    const lambdaDs = new appsync.CfnDataSource(this, `${proj}LambdaDs`, {
      apiId: api.attrApiId,
      name: `${proj}LambdaDs`,
      type: "AWS_LAMBDA",
      lambdaConfig: {
        lambdaFunctionArn: fn.functionArn
      },
      serviceRoleArn: lambdaRole.roleArn
    });

    const schema = fs.readFileSync("./assets/appsync/schema.graphql", "utf8");

    new appsync.CfnGraphQLSchema(this, `${proj}Schema`, {
      apiId: api.attrApiId,
      definition: schema
    });

    const requestTemplateGetItem = fs.readFileSync(
      "./assets/appsync/resolvers/Query.getItem.request",
      "utf8"
    );
    const responseTemplateGetItem = fs.readFileSync(
      "./assets/appsync/resolvers/Query.getItem.response",
      "utf8"
    );

    new appsync.CfnResolver(this, `${proj}GetItem`, {
      apiId: api.attrApiId,
      fieldName: "getItem",
      typeName: "Query",
      dataSourceName: lambdaDs.attrName,
      kind: "UNIT",
      requestMappingTemplate: requestTemplateGetItem,
      responseMappingTemplate: responseTemplateGetItem
    });

    const expires: number =
      Math.floor(new Date().getTime() / 1000) + 365 * 24 * 60 * 60;

    const apikey = new appsync.CfnApiKey(this, `${proj}ApiKey`, {
      apiId: api.attrApiId,
      expires
    });

    new cdk.CfnOutput(this, "fnCliCmd", {
      description: "fnCliCmd",
      value:
        "yarn build && cd assets/lambda/typeorm/fn && touch typeorm.zip && rm typeorm.zip && find ./ -path '*/.*' -prune -o -type f -print | zip ./typeorm.zip -@ && aws lambda update-function-code --region us-east-1 --function-name " +
        fn.functionName +
        " --zip-file fileb://./typeorm.zip && rm typeorm.zip && cd ../../../.."
    });
  }
}
