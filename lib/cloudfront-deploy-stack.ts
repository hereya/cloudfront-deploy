import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import * as path from 'node:path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Certificate, CertificateValidation, DnsValidatedCertificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
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

        // Optional Basic Auth protection
        const basicAuthPassword = process.env['basicAuthPassword'];

        // `customDomain` accepts several domains, comma-separated: ONE
        // distribution then serves every brand, instead of one distribution per
        // brand all shipping the same bundle. The first domain is the primary.
        const domains = parseDomains(process.env['customDomain']);
        const customDomain: string | undefined = domains[0];
        const extraDomains = domains.slice(1);

        // An already-issued certificate (us-east-1) to use INSTEAD of
        // provisioning one. Required as soon as a domain is not in a Route 53
        // zone of this account: a certificate can only be DNS-validated
        // automatically inside a zone we control, and CloudFront accepts
        // exactly ONE certificate per distribution - so a customer-owned domain
        // means a single certificate covering every domain, issued out of band
        // and validated in part by its owner.
        const customDomainCertificateArn = process.env['customDomainCertificateArn'];

        // Apex handling (www as canonical + apex redirect) is a single-domain
        // feature; it stays exactly as it was and does not apply to a list.
        const isApexDomain = domains.length === 1 && !!customDomain
            && !customDomain.includes('www.') && customDomain.split('.').length === 2;
        const apexDomain = isApexDomain ? customDomain : null;
        const wwwDomain = isApexDomain ? `www.${customDomain}` : customDomain;
        const canonicalDomain = wwwDomain; // WWW is always canonical when apex is provided

        let domainZone = process.env['domainZone'] as string;
        if (customDomain && !domainZone && !customDomainCertificateArn) {
            // For apex domains, use the apex as the zone
            domainZone = isApexDomain ? customDomain : customDomain.split('.').slice(1).join('.');
        }

        // Every domain the distribution answers on.
        const distributionDomains = isApexDomain
            ? [wwwDomain!, apexDomain!]
            : domains;
        // A domain gets a record here only if it belongs to the zone we look
        // up. A customer-owned domain is served all the same - its DNS simply
        // lives with its owner, who aliases it to the distribution.
        const inOurZone = (domain: string) => !!domainZone
            && (domain === domainZone || domain.endsWith(`.${domainZone}`));

        let certificate: ICertificate | undefined;
        let hostedZone: IHostedZone | undefined;
        if (customDomain) {
            if (domainZone) {
                hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
                    domainName: domainZone,
                })
            }

            if (customDomainCertificateArn) {
                // CloudFront only accepts certificates from us-east-1. Caught
                // here because the CloudFormation error for this is opaque.
                const certRegion = customDomainCertificateArn.split(':')[3];
                if (certRegion && certRegion !== 'us-east-1') {
                    throw new Error(
                        `customDomainCertificateArn must be a us-east-1 certificate for CloudFront, got ${certRegion}`
                    );
                }
                certificate = Certificate.fromCertificateArn(this, 'Certificate', customDomainCertificateArn);
            } else {
                const outOfZone = distributionDomains.filter(d => !inOurZone(d));
                if (outOfZone.length > 0) {
                    // Issuing here would park the validation records in OUR
                    // zone, where they validate nothing: the certificate would
                    // never issue and the deploy would hang, then fail.
                    throw new Error(
                        `${outOfZone.join(', ')} is outside the zone ${domainZone}: supply customDomainCertificateArn (a certificate covering every domain, validated by their owners)`
                    );
                }
                if (isApexDomain) {
                    // Certificate with www as primary and apex as SAN
                    certificate = new DnsValidatedCertificate(this, 'Certificate', {
                        domainName: wwwDomain!,  // Primary: www
                        subjectAlternativeNames: [apexDomain!],  // SAN: apex
                        hostedZone: hostedZone!,
                        region: 'us-east-1',
                        validation: CertificateValidation.fromDns(hostedZone),
                    })
                } else {
                    // Existing behavior for non-apex domains, extended to the
                    // additional domains as SANs on the same certificate.
                    certificate = new DnsValidatedCertificate(this, 'Certificate', {
                        domainName: customDomain,
                        subjectAlternativeNames: extraDomains.length > 0 ? extraDomains : undefined,
                        hostedZone: hostedZone!,
                        region: 'us-east-1',
                        validation: CertificateValidation.fromDns(hostedZone),
                    })
                }
            }
        }

        // Using Origin Access Control (OAC) instead of OAI - handled automatically by S3BucketOrigin.withOriginAccessControl()

        // Combined function handling auth, apex redirect and URL rewriting
        const urlRewriteFunction = new cloudfront.Function(this, 'UrlRewriteFunction', {
            runtime: cloudfront.FunctionRuntime.JS_2_0,
            code: cloudfront.FunctionCode.fromInline(`
async function handler(event) {
    const request = event.request;
    const uri = request.uri;
    const host = request.headers.host ? request.headers.host.value : '';

    // Basic Auth protection (if enabled)
    const basicAuthEnabled = ${basicAuthPassword ? 'true' : 'false'};
    const expectedPassword = ${basicAuthPassword ? JSON.stringify(basicAuthPassword) : 'null'};

    if (basicAuthEnabled) {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.value) {
            return {
                statusCode: 401,
                statusDescription: 'Unauthorized',
                headers: {
                    'www-authenticate': { value: 'Basic realm="Protected Site"' },
                    'content-type': { value: 'text/plain' }
                },
                body: { encoding: 'text', data: 'Unauthorized' }
            };
        }

        const authValue = authHeader.value;
        if (!authValue.startsWith('Basic ')) {
            return {
                statusCode: 401,
                statusDescription: 'Unauthorized',
                headers: {
                    'www-authenticate': { value: 'Basic realm="Protected Site"' },
                    'content-type': { value: 'text/plain' }
                },
                body: { encoding: 'text', data: 'Invalid authentication method' }
            };
        }

        try {
            const decoded = atob(authValue.substring(6));
            const colonIndex = decoded.indexOf(':');
            if (colonIndex === -1) {
                return {
                    statusCode: 401,
                    statusDescription: 'Unauthorized',
                    headers: {
                        'www-authenticate': { value: 'Basic realm="Protected Site"' },
                        'content-type': { value: 'text/plain' }
                    },
                    body: { encoding: 'text', data: 'Invalid credentials format' }
                };
            }
            const providedPassword = decoded.substring(colonIndex + 1);
            if (providedPassword !== expectedPassword) {
                return {
                    statusCode: 401,
                    statusDescription: 'Unauthorized',
                    headers: {
                        'www-authenticate': { value: 'Basic realm="Protected Site"' },
                        'content-type': { value: 'text/plain' }
                    },
                    body: { encoding: 'text', data: 'Invalid credentials' }
                };
            }
        } catch (e) {
            return {
                statusCode: 401,
                statusDescription: 'Unauthorized',
                headers: {
                    'www-authenticate': { value: 'Basic realm="Protected Site"' },
                    'content-type': { value: 'text/plain' }
                },
                body: { encoding: 'text', data: 'Invalid credentials format' }
            };
        }
    }

    // Handle apex to www redirect if this is an apex domain
    const isApexDomain = ${isApexDomain ? 'true' : 'false'};
    const apexDomain = ${apexDomain ? `'${apexDomain}'` : 'null'};
    const wwwDomain = ${wwwDomain ? `'${wwwDomain}'` : 'null'};

    if (isApexDomain && host === apexDomain) {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: 'https://' + wwwDomain + uri }
            }
        };
    }

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
            domainNames: customDomain ? distributionDomains : undefined,
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
            if (isApexDomain) {
                // A record for apex domain (will redirect to www)
                new ARecord(this, 'ApexAliasRecord', {
                    zone: hostedZone,
                    target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
                    recordName: apexDomain!,
                });
                
                // A record for www subdomain (primary)
                new ARecord(this, 'WwwAliasRecord', {
                    zone: hostedZone,
                    target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
                    recordName: wwwDomain!,
                });
            } else {
                // Existing behavior for non-apex domains. The primary keeps the
                // historical construct id so an existing stack is untouched;
                // additional domains are numbered from their own index, and a
                // domain outside our zone gets no record at all.
                domains.forEach((domain, index) => {
                    if (!inOurZone(domain)) {
                        return;
                    }
                    new ARecord(this, index === 0 ? 'AliasRecord' : `AliasRecord${index}`, {
                        zone: hostedZone!,
                        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
                        recordName: domain,
                    });
                });
            }
        }

        new CfnOutput(this, 'BucketName', {
            value: bucket.bucketName,
        })

        if (customDomain) {
            if (isApexDomain) {
                new CfnOutput(this, 'PrimaryDomain', {
                    value: canonicalDomain!,
                    description: 'Primary domain (canonical URL)',
                });
                
                new CfnOutput(this, 'ApexDomain', {
                    value: apexDomain!,
                    description: 'Apex domain (redirects to www)',
                });
            } else {
                new CfnOutput(this, 'DomainName', {
                    value: customDomain,
                });
            }
        } else {
            new CfnOutput(this, 'DistributionDomainName', {
                value: distribution.distributionDomainName,
            })
        }
    }
}

function parseDomains(input: string | undefined): string[] {
    if (!input) return [];
    return input.split(',').map(d => d.trim()).filter(d => d.length > 0);
}
