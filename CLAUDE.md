# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AWS CDK TypeScript project for deploying websites to CloudFront with S3 storage. It's part of the Hereya platform and supports both single-page applications (SPAs) and traditional multi-page websites.

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run watch

# Run tests
npm run test

# Run a specific test
npm test -- --testNamePattern="test name"
```

### CDK Operations
```bash
# Synthesize CloudFormation template
npx cdk synth

# Compare with deployed stack
npx cdk diff

# Deploy to AWS
npx cdk deploy

# Deploy with specific parameters
STACK_NAME=my-website npx cdk deploy

# Destroy stack
npx cdk destroy
```

### Environment Variables
The stack uses these environment variables:
- `STACK_NAME` - CDK stack identifier (required)
- `distFolder` - Source directory for files to deploy (default: 'dist')
- `hereyaProjectRootDir` - Project root path
- `isSpa` - 'true' for SPA routing, 'false' for traditional website
- `customDomain` - Optional custom domain name
- `domainZone` - DNS zone for custom domain

## Architecture

### Stack Components
The main stack (`lib/cloudfront-deploy-stack.ts`) creates:

1. **S3 Bucket** - Private bucket for static files
2. **CloudFront Distribution** - CDN with intelligent routing
3. **CloudFront Function** - URL rewriting logic that adapts based on `isSpa` setting
4. **Origin Access Identity** - Secure S3 access
5. **Certificate Manager** (optional) - SSL for custom domains
6. **Route53 Records** (optional) - DNS for custom domains
7. **Bucket Deployment** - Uploads files and invalidates cache

### Routing Logic
The CloudFront function (`urlRewriteFunction`) implements smart routing:
- **SPA mode**: All non-file requests route to index.html
- **Traditional mode**: Standard web server behavior with directory indexes
- Handles trailing slashes, file extensions, and error pages appropriately

### Caching Strategy
- HTML files: No caching (always fresh)
- Static assets (JS, CSS, images): 1 year cache
- Automatic cache invalidation on deployment

## Testing

Tests use Jest with ts-jest. Test files follow the pattern `*.test.ts` in the `test/` directory. Note: Current tests are minimal and mostly commented out.

## Key Implementation Details

When modifying the stack:
1. The `isSpa` environment variable fundamentally changes routing behavior
2. Custom domains require both `customDomain` and `domainZone` to be set
3. Certificate validation uses DNS validation via Route53
4. Cross-region references are supported for certificates
5. Files are deployed from `distFolder` to the S3 bucket root
6. Cache invalidation runs automatically after file upload

## Development Tips

- Always run `npm run build` before `cdk synth` or `cdk deploy`
- Use `cdk diff` to preview changes before deployment
- The CloudFront function code is embedded as a string in the stack - be careful with escaping
- Environment variables are read at CDK synthesis time, not runtime