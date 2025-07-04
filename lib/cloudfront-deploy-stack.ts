import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import * as path from 'node:path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Distribution, OriginAccessIdentity, ViewerProtocolPolicy, ErrorResponse } from 'aws-cdk-lib/aws-cloudfront';
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

        // Check if this is an SPA or traditional website
        const isSpa = process.env['isSpa'] === 'true';

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

        // Enhanced URL rewrite function for better SPA support
        const urlRewriteFunction = new cloudfront.Function(this, 'UrlRewriteFunction', {
            runtime: cloudfront.FunctionRuntime.JS_2_0,
            code: cloudfront.FunctionCode.fromInline(`
async function handler(event) {
    const request = event.request;
    const uri = request.uri;
    
    // Only apply SPA routing if this is configured as an SPA
    const isSpa = ${isSpa};
    
    if (isSpa) {
        // Handle root path
        if (uri === '/') {
            request.uri = '/index.html';
            return request;
        }
        
        // Check if the URI ends with a slash (directory)
        if (uri.endsWith('/')) {
            request.uri = uri + 'index.html';
            return request;
        }
        
        // Check if the URI doesn't have a file extension (likely a route)
        if (!uri.includes('.')) {
            request.uri = '/index.html';
            return request;
        }
    } else {
        // For non-SPA: only handle root path and trailing slashes
        if (uri === '/') {
            request.uri = '/index.html';
            return request;
        }
        
        // Remove trailing slash for non-SPA (optional)
        if (uri.endsWith('/') && uri !== '/') {
            request.uri = uri.slice(0, -1);
            return request;
        }
    }
    
    // For files with extensions, serve as-is
    return request;
}
            `)
        })

        const distribution = new Distribution(this, 'Distribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new S3Origin(bucket, { originAccessIdentity }),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                // Cache static assets aggressively
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                // Compress responses
                compress: true,
            },
            additionalBehaviors: {
                // Handle all routes for SPA
                '/*': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    functionAssociations: [
                        {
                            function: urlRewriteFunction,
                            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                        }
                    ],
                    // Cache policy depends on whether it's SPA or not
                    cachePolicy: isSpa 
                        ? cloudfront.CachePolicy.CACHING_DISABLED  // Don't cache HTML for SPA updates
                        : cloudfront.CachePolicy.CACHING_OPTIMIZED, // Cache everything for traditional sites
                    compress: true,
                },
                // Cache static assets (JS, CSS, images) aggressively
                '*.js': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.css': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.png': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.jpg': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.jpeg': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.gif': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.svg': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.ico': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.woff': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.woff2': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.ttf': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.eot': {
                    origin: new S3Origin(bucket, { originAccessIdentity }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
            },
            domainNames: customDomain ? [customDomain] : undefined,
            certificate: certificate,
            // Add error pages for SPA - redirect 404s to index.html
            errorResponses: isSpa ? [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.seconds(0),
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.seconds(0),
                },
            ] : undefined,
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
