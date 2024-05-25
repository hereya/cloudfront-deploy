import * as cdk from 'aws-cdk-lib';
import { CfnParameter } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CloudfrontDeployStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const hereyaProjectEnv = new CfnParameter(this, 'hereyaProjectEnv', {
            type: 'String',
            description: 'Environment variables for the project to deploy',
        });

        const hereyaProjectRootDir = new CfnParameter(this, 'hereyaProjectRootDir', {
            type: 'String',
            description: 'Root directory of the project to deploy',
        });

        console.log(hereyaProjectEnv.valueAsString);
        console.log(hereyaProjectRootDir.valueAsString);
    }
}
