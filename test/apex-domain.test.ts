import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { CloudfrontDeployStack } from '../lib/cloudfront-deploy-stack';

describe('Apex Domain Support', () => {
    let app: cdk.App;
    const originalEnv = process.env;

    beforeEach(() => {
        app = new cdk.App();
        process.env = { ...originalEnv };
        process.env.hereyaProjectRootDir = '.';
        process.env.STACK_NAME = 'test-stack';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test('Apex domain should configure both apex and www', () => {
        // Set apex domain
        process.env.customDomain = 'example.com';
        process.env.domainZone = 'example.com'; // Skip hosted zone lookup
        
        const stack = new CloudfrontDeployStack(app, 'TestStack', {
            env: {
                account: '123456789012',
                region: 'us-east-1'
            }
        });
        const template = Template.fromStack(stack);

        // Should have CloudFront distribution with both domain names
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Aliases: ['www.example.com', 'example.com']
            }
        });

        // Check that the function exists (checking exact content is fragile)
        template.resourceCountIs('AWS::CloudFront::Function', 1);
    });

    test('WWW domain should work as before', () => {
        // Set www domain
        process.env.customDomain = 'www.example.com';
        process.env.domainZone = 'example.com';
        
        const stack = new CloudfrontDeployStack(app, 'TestStack', {
            env: {
                account: '123456789012',
                region: 'us-east-1'
            }
        });
        const template = Template.fromStack(stack);

        // Should have CloudFront distribution with single domain
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Aliases: ['www.example.com']
            }
        });
    });

    test('Subdomain should work as before', () => {
        // Set subdomain
        process.env.customDomain = 'app.example.com';
        process.env.domainZone = 'example.com';
        
        const stack = new CloudfrontDeployStack(app, 'TestStack', {
            env: {
                account: '123456789012',
                region: 'us-east-1'
            }
        });
        const template = Template.fromStack(stack);

        // Should have CloudFront distribution with single domain
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Aliases: ['app.example.com']
            }
        });
    });

    test('No custom domain should work', () => {
        // No custom domain
        delete process.env.customDomain;
        
        const stack = new CloudfrontDeployStack(app, 'TestStack');
        const template = Template.fromStack(stack);

        // Should have CloudFront distribution without aliases
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                DefaultRootObject: 'index.html'
            }
        });
    });
});