import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
  aws_appsync as appsync,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { HostingConfig } from "./config";

interface ZoneProps {
  hosting: HostingConfig;
  domain: string;
}

const zoneOf = (scope: Construct, { hosting }: ZoneProps) =>
  route53.HostedZone.fromHostedZoneAttributes(scope, "Zone", { hostedZoneId: hosting.hostedZoneId, zoneName: hosting.zoneName });

/** CloudFront certificates must live in us-east-1. DNS-validated in the existing zone. */
export class CertStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: StackProps & ZoneProps) {
    super(scope, id, props);
    this.certificate = new acm.Certificate(this, "Cert", {
      domainName: props.domain,
      validation: acm.CertificateValidation.fromDns(zoneOf(this, props)),
    });
  }
}

interface WebStackProps extends StackProps, ZoneProps {
  certificate: acm.ICertificate;
  userPool: cognito.IUserPool;
  client: cognito.IUserPoolClient;
  api: appsync.IGraphqlApi & { graphqlUrl: string };
  /** The built web app (web/dist). */
  webDist: string;
}

/**
 * The PWA: a private S3 bucket that only CloudFront can read (Origin Access Control), served at the
 * app domain with a strict CSP. The static shell is public by design (it holds no data or secrets);
 * everything behind it needs a Cognito sign-in, enforced by AppSync.
 */
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const region = this.region;

    const bucket = new s3.Bucket(this, "Web", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, "Headers", {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            `connect-src 'self' https://*.appsync-api.${region}.amazonaws.com https://cognito-idp.${region}.amazonaws.com`,
            "manifest-src 'self'",
            "worker-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
          ].join("; "),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: false },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN },
      },
    });

    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
      },
      defaultRootObject: "index.html",
      // SPA: deep links (filter state lives in the URL) fall back to index.html.
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) })),
      domainNames: [props.domain],
      certificate: props.certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new s3deploy.BucketDeployment(this, "Deploy", {
      destinationBucket: bucket,
      sources: [
        s3deploy.Source.asset(props.webDist),
        // Runtime config (web/src/config.ts), so the build has no environment baked in.
        s3deploy.Source.jsonData("config.json", {
          region,
          userPoolId: props.userPool.userPoolId,
          clientId: props.client.userPoolClientId,
          graphqlUrl: props.api.graphqlUrl,
        }),
      ],
      // Vite assets are content-hashed; no-cache just forces cheap revalidation of index/config/sw.
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ["/*"],
    });

    const zone = zoneOf(this, props);
    for (const [name, Rec] of [["A", route53.ARecord], ["AAAA", route53.AaaaRecord]] as const) {
      new Rec(this, `Alias${name}`, {
        zone,
        recordName: props.domain,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    new CfnOutput(this, "Url", { value: `https://${props.domain}` });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
  }
}
