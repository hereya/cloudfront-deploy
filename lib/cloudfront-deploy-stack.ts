import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import * as path from 'node:path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
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

        // Using Origin Access Control (OAC) instead of OAI - handled automatically by S3BucketOrigin.withOriginAccessControl()

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
        // For non-SPA: handle root path, directories, and index files
        if (uri === '/') {
            request.uri = '/index.html';
            return request;
        }
        
        // Handle trailing slashes - append index.html
        if (uri.endsWith('/')) {
            request.uri = uri + 'index.html';
            return request;
        }
        
        // If URI doesn't have a file extension, treat it as a directory
        // and append /index.html
        if (!uri.includes('.')) {
            request.uri = uri + '/index.html';
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
                origin: S3BucketOrigin.withOriginAccessControl(bucket),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                // Cache static assets aggressively
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                // Compress responses
                compress: true,
            },
            additionalBehaviors: {
                // Handle all routes for SPA
                '/*': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
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
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.css': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.png': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.jpg': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.jpeg': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.gif': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.svg': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.ico': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.woff': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.woff2': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.ttf': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    compress: true,
                },
                '*.eot': {
                    origin: S3BucketOrigin.withOriginAccessControl(bucket),
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
