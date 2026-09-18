# CloudFront Deploy

AWS CDK stack for deploying static websites to CloudFront with S3 storage. Supports both single-page applications (SPAs) and traditional multi-page websites.

## Features

- S3 bucket for static file storage
- CloudFront CDN distribution with HTTPS
- Automatic SSL certificate provisioning (with custom domains)
- SPA routing support (client-side routing)
- Optional HTTP Basic Auth protection
- Apex domain to www redirect support
- Several domains (brands) on a single distribution, including domains owned by someone else

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STACK_NAME` | Yes | - | CDK stack identifier |
| `hereyaProjectRootDir` | Yes | - | Absolute path to the project root directory |
| `distFolder` | No | `dist` | Directory containing the built static files (relative to `hereyaProjectRootDir`) |
| `isSpa` | No | `false` | Set to `true` for single-page application routing (all non-file routes serve index.html) |
| `customDomain` | No | - | Custom domain name(s), comma-separated (e.g., `example.com`, or `a.example.com,b.example.com`). All are served by ONE distribution; the first is the primary |
| `domainZone` | No | Auto-detected from the primary domain (never auto-detected when `customDomainCertificateArn` is set) | DNS hosted zone for the custom domains |
| `customDomainCertificateArn` | No | - | Existing **us-east-1** ACM certificate to use instead of issuing one. Required as soon as a domain is not in a hosted zone of this account |
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

### Several domains on one distribution

`customDomain` takes a list, so one distribution serves every brand instead of
one distribution per brand all shipping the same bundle:

```bash
customDomain=provider.curanet.dev,ronyx-provider.curanet.dev
```

One certificate is issued covering them all, and each domain in `domainZone`
gets its own alias record. Apex/www handling applies to a single domain only.

**Migrating an existing domain is not transparent:** CloudFront refuses the same
alias on two distributions, so a domain must be removed from its old
distribution *before* the new one claims it - there is a short window where it
does not answer. Plan it, and keep the old distribution until the new one is
verified.

### Domains owned by someone else

A certificate is only DNS-validated automatically inside a zone of this account,
and CloudFront accepts exactly ONE certificate per distribution. So serving a
customer's domain alongside ours means a single certificate covering every
domain, issued out of band - we request it, the customer adds the validation
records for their own names - and handed over as
`customDomainCertificateArn`. Domains outside `domainZone` deliberately get
**no** record here: their DNS belongs to their owner, who aliases them to the
distribution. A domain outside the zone with no supplied certificate is refused
at synth time rather than hanging the deploy on a validation that can never
succeed.

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
