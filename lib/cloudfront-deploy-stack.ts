import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import * as path from 'node:path';
import { Distribution, OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CertificateValidation, DnsValidatedCertificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, HostedZone, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';

export class CloudfrontDeployStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const bucket = new Bucket(this, 'Bucket', {
            accessControl: BucketAccessControl.PRIVATE,
            autoDeleteObjects: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        })

        const distFolder: string = this.node.tryGetContext('distFolder') ?? 'dist';
        const hereyaProjectRootDir: string = this.node.tryGetContext('hereyaProjectRootDir');
        if(!hereyaProjectRootDir) {
            throw new Error('hereyaProjectRootDir context variable is required');
        }

        const customDomain = this.node.tryGetContext('customDomain');
        const domainZone = this.node.tryGetContext('domainZone');
        if(customDomain && !domainZone) {
            throw new Error('domainZone context variable is required when using customDomain');
        }

        let certificate: ICertificate | undefined;
        let hostedZone: IHostedZone | undefined;
        if(customDomain) {
            hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
                domainName: domainZone,
            })

            certificate = new DnsValidatedCertificate(this, 'Certificate', {
                domainName: customDomain,
                hostedZone,
                region: 'us-east-1',
                validation: CertificateValidation.fromDns(hostedZone),
            })
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
            domainNames: customDomain ? [customDomain] : undefined,
            certificate: certificate,
        })

        if( customDomain && hostedZone ) {
            new ARecord(this, 'AliasRecord', {
                zone: hostedZone,
                target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
                recordName: customDomain,
            })
        }


        new CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
        })

        if(customDomain) {
            new CfnOutput(this, 'DomainName', {
                value: customDomain,
            })
        } else {
            new CfnOutput(this, 'DistributionDomainName', {
                value: distribution.distributionDomainName,
            })
        }
    }
}
