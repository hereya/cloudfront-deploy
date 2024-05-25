#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CloudfrontDeployStack } from '../lib/cloudfront-deploy-stack';

const app = new cdk.App();
new CloudfrontDeployStack(app, process.env.STACK_NAME!)
