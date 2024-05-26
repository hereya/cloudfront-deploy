import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import * as path from 'node:path';
import { Distribution, OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';

export class CloudfrontDeployStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const bucket = new Bucket(this, 'Bucket', {
            accessControl: BucketAccessControl.PRIVATE,
            autoDeleteObjects: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        })

        const hereyaProjectRootDir: string = this.node.tryGetContext('hereyaProjectRootDir');
        const distFolder: string = this.node.tryGetContext('distFolder') ?? 'dist';
        if(!hereyaProjectRootDir) {
            throw new Error('hereyaProjectRootDir context variable is required');
        }

        new BucketDeployment(this, 'BucketDeployment', {
            destinationBucket: bucket,
            sources: [Source.asset(path.resolve(hereyaProjectRootDir, distFolder))]
        })

        const originAccessIdentity = new OriginAccessIdentity(this, 'OriginAccessIdentity');
        bucket.grantRead(originAccessIdentity);

        const distribution = new Distribution(this, 'Distribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new S3Origin(bucket, {originAccessIdentity}),
            },
        })

        new CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
        })

        new CfnOutput(this, 'DistributionDomainName', {
            value: distribution.distributionDomainName,
        })

    }
}
