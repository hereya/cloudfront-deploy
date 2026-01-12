# CloudFront Deploy

AWS CDK stack for deploying static websites to CloudFront with S3 storage. Supports both single-page applications (SPAs) and traditional multi-page websites.

## Features

- S3 bucket for static file storage
- CloudFront CDN distribution with HTTPS
- Automatic SSL certificate provisioning (with custom domains)
- SPA routing support (client-side routing)
- Optional HTTP Basic Auth protection
- Apex domain to www redirect support

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STACK_NAME` | Yes | - | CDK stack identifier |
| `hereyaProjectRootDir` | Yes | - | Absolute path to the project root directory |
| `distFolder` | No | `dist` | Directory containing the built static files (relative to `hereyaProjectRootDir`) |
| `isSpa` | No | `false` | Set to `true` for single-page application routing (all non-file routes serve index.html) |
| `customDomain` | No | - | Custom domain name (e.g., `example.com` or `www.example.com`) |
| `domainZone` | No | Auto-detected | DNS hosted zone for the custom domain |
| `basicAuthPassword` | No | - | Password for HTTP Basic Auth protection. When set, users must authenticate to access the site. Username can be anything. |

## Usage

### Basic deployment (CloudFront domain)

```bash
STACK_NAME=my-website \
hereyaProjectRootDir=/path/to/project \
npx cdk deploy
```

### SPA with custom domain

```bash
STACK_NAME=my-spa \
hereyaProjectRootDir=/path/to/project \
distFolder=build \
isSpa=true \
customDomain=example.com \
npx cdk deploy
```

### Password-protected site

```bash
STACK_NAME=staging-site \
hereyaProjectRootDir=/path/to/project \
basicAuthPassword=secret123 \
npx cdk deploy
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch for changes and compile |
| `npm run test` | Run Jest unit tests |
| `npx cdk deploy` | Deploy stack to AWS |
| `npx cdk diff` | Compare deployed stack with current state |
| `npx cdk synth` | Output the synthesized CloudFormation template |
| `npx cdk destroy` | Delete the stack and all resources |
