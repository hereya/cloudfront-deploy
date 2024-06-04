import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import * as path from 'node:path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Distribution, OriginAccessIdentity, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
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

        const distFolder: string = process.env['distFolder'] ?? 'dist';
        const hereyaProjectRootDir: string = process.env['hereyaProjectRootDir'] as string;
        if (!hereyaProjectRootDir) {
            throw new Error('hereyaProjectRootDir context variable is required');
        }

        const customDomain = process.env['customDomain'];
        let domainZone = process.env['domainZone'] as string;
        if (customDomain && !domainZone) {
            domainZone = customDomain.split('.').slice(1).join('.');
        }

        let certificate: ICertificate | undefined;
        let hostedZone: IHostedZone | undefined;
        if (customDomain) {
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


        const originAccessIdentity = new OriginAccessIdentity(this, 'OriginAccessIdentity');
        bucket.grantRead(originAccessIdentity);

        const urlRewriteFunction = new cloudfront.Function(this, 'UrlRewriteFunction', {
            runtime: cloudfront.FunctionRuntime.JS_2_0,
            code: cloudfront.FunctionCode.fromInline(`
async function handler(event) {
    const request = event.request;
    const uri = request.uri;
    
    // Check whether the URI is missing a file name.
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    } 
    // Check whether the URI is missing a file extension.
    else if (!uri.includes('.')) {
        request.uri += '/index.html';
    }

    return request;
}
            `)
        })

        const distribution = new Distribution(this, 'Distribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new S3Origin(bucket, { originAccessIdentity }),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            additionalBehaviors: {
                '/*': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    functionAssociations: [
                        {
                            function: urlRewriteFunction,
                            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                        }
                    ]
                }
            },
            domainNames: customDomain ? [customDomain] : undefined,
            certificate: certificate,

        })

        new BucketDeployment(this, 'BucketDeployment', {
            destinationBucket: bucket,
            sources: [Source.asset(path.resolve(hereyaProjectRootDir, distFolder))],
            distribution,
            distributionPaths: ['/*'],
        })

        if (customDomain && hostedZone) {
            new ARecord(this, 'AliasRecord', {
                zone: hostedZone,
                target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
                recordName: customDomain,
            })
        }


        new CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
        })

        if (customDomain) {
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
