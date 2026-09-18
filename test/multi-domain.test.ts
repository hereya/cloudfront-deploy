import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { CloudfrontDeployStack } from '../lib/cloudfront-deploy-stack';

const CERT_US_EAST_1 =
    'arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555';
const CERT_EU_WEST_1 =
    'arn:aws:acm:eu-west-1:123456789012:certificate/11111111-2222-3333-4444-555555555555';

describe('Several domains on one distribution', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.hereyaProjectRootDir = '.';
        process.env.STACK_NAME = 'test-stack';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    function synth(): Template {
        const stack = new CloudfrontDeployStack(new cdk.App(), 'TestStack', {
            env: { account: '123456789012', region: 'us-east-1' },
        });
        return Template.fromStack(stack);
    }

    test('every brand domain is served by ONE distribution, on one certificate', () => {
        process.env.customDomain = 'provider.curanet.dev,ronyx-provider.curanet.dev';
        process.env.domainZone = 'curanet.dev';

        const template = synth();

        template.resourceCountIs('AWS::CloudFront::Distribution', 1);
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Aliases: ['provider.curanet.dev', 'ronyx-provider.curanet.dev'],
            },
        });
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
            DomainName: 'provider.curanet.dev',
            SubjectAlternativeNames: ['ronyx-provider.curanet.dev'],
        });
    });

    test('each in-zone domain gets its own record, the first keeping its historical id', () => {
        process.env.customDomain = 'provider.curanet.dev,ronyx-provider.curanet.dev';
        process.env.domainZone = 'curanet.dev';

        const records = synth().findResources('AWS::Route53::RecordSet');
        const ids = Object.keys(records);

        expect(ids).toEqual(
            expect.arrayContaining([
                expect.stringMatching(/^AliasRecord[A-Z0-9]+$/),
                expect.stringMatching(/^AliasRecord1[A-Z0-9]+$/),
            ])
        );
        const names = Object.values(records).map((r) => r.Properties?.Name);
        expect(names).toEqual(
            expect.arrayContaining([
                'provider.curanet.dev.',
                'ronyx-provider.curanet.dev.',
            ])
        );
    });

    test('a customer domain is served, with a supplied certificate and no record in our zone', () => {
        process.env.customDomain = 'provider.curanet.dev,provider.royalonyx.com';
        process.env.domainZone = 'curanet.dev';
        process.env.customDomainCertificateArn = CERT_US_EAST_1;

        const template = synth();

        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Aliases: ['provider.curanet.dev', 'provider.royalonyx.com'],
                ViewerCertificate: { AcmCertificateArn: CERT_US_EAST_1 },
            },
        });
        const names = Object.values(
            template.findResources('AWS::Route53::RecordSet')
        ).map((r) => r.Properties?.Name);
        expect(names).toEqual(expect.arrayContaining(['provider.curanet.dev.']));
        expect(names).not.toEqual(
            expect.arrayContaining(['provider.royalonyx.com.'])
        );
    });

    test('a domain we do not host without a certificate is refused, not silently hung', () => {
        process.env.customDomain = 'provider.curanet.dev,provider.royalonyx.com';
        process.env.domainZone = 'curanet.dev';

        expect(() => synth()).toThrow(/provider\.royalonyx\.com is outside the zone/);
    });

    test('a certificate outside us-east-1 is refused up front', () => {
        process.env.customDomain = 'provider.royalonyx.com';
        process.env.customDomainCertificateArn = CERT_EU_WEST_1;

        expect(() => synth()).toThrow(/must be a us-east-1 certificate/);
    });

    test('apex handling still applies to a single domain and not to a list', () => {
        process.env.customDomain = 'example.com';
        process.env.domainZone = 'example.com';

        const apex = synth();
        apex.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: { Aliases: ['www.example.com', 'example.com'] },
        });

        process.env = { ...originalEnv };
        process.env.hereyaProjectRootDir = '.';
        process.env.STACK_NAME = 'test-stack';
        process.env.customDomain = 'example.com,other.example.com';
        process.env.domainZone = 'example.com';

        const list = synth();
        list.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: { Aliases: ['example.com', 'other.example.com'] },
        });
    });
});
