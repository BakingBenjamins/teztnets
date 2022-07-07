import * as pulumi from "@pulumi/pulumi"
import * as eks from "@pulumi/eks"
import * as k8s from "@pulumi/kubernetes"
import * as awsx from "@pulumi/awsx"
import * as aws from "@pulumi/aws"
import * as tezos from "@oxheadalpha/tezos-pulumi"
var blake2b = require('blake2b');
const bs58check = require('bs58check');

require('dotenv').config();

import deployAwsAlbController from "./awsAlbController"
import deployExternalDns from "./externalDns"
import { TezosChain, TezosChainParametersBuilder } from "./TezosChain"
import { TezosSigner, TezosSignerParametersBuilder } from "./TezosSigner"
import { createCertValidation } from "./route53";

let stack = pulumi.getStack()

// Function to fail on non-truthy variable.
const getEnvVariable = (name: string): string => {
  const env = process.env[name]
  if (!env) {
    pulumi.log.error(`${name} environment variable is not set`)
    throw Error
  }
  return env
}

const repo = new awsx.ecr.Repository(stack)

const desiredClusterCapacity = 2
const aws_account_id = getEnvVariable("AWS_ACCOUNT_ID")
const private_oxhead_baking_key = getEnvVariable("PRIVATE_OXHEAD_BAKING_KEY")
const faucetSeed = getEnvVariable("FAUCET_SEED")
const faucetRecaptchaSiteKey = getEnvVariable("FAUCET_RECAPTCHA_SITE_KEY")
const faucetRecaptchaSecretKey = getEnvVariable("FAUCET_RECAPTCHA_SECRET_KEY")

// Create a VPC with subnets that are tagged for load balancer usage.
// See: https://github.com/pulumi/pulumi-eks/tree/master/examples/subnet-tags
const vpc = new awsx.ec2.Vpc(
  "vpc",
  {
    subnets: [
      // Tag subnets for specific load-balancer usage.
      // Any non-null tag value is valid.
      // See:
      //  - https://docs.aws.amazon.com/eks/latest/userguide/network_reqs.html
      //  - https://github.com/pulumi/pulumi-eks/issues/196
      //  - https://github.com/pulumi/pulumi-eks/issues/415
      { type: "public", tags: { "kubernetes.io/role/elb": "1" } },
      { type: "private", tags: { "kubernetes.io/role/internal-elb": "1" } },
    ],
  },
  {
    // Inform pulumi to ignore tag changes to the VPCs or subnets, so that
    // tags auto-added by AWS EKS do not get removed during future
    // refreshes and updates, as they are added outside of pulumi's management
    // and would be removed otherwise.
    // See: https://github.com/pulumi/pulumi-eks/issues/271#issuecomment-548452554
    transformations: [
      (args: any) => {
        if (
          args.type === "aws:ec2/vpc:Vpc" ||
          args.type === "aws:ec2/subnet:Subnet"
        ) {
          return {
            props: args.props,
            opts: pulumi.mergeOptions(args.opts, { ignoreChanges: ["tags"] }),
          }
        }
        return undefined
      },
    ],
  }
)

const kubeAdminRoleARN = "arn:aws:iam::${aws_account_id}:role/tempKubernetesAdmin"
const cluster = new eks.Cluster(stack, {
  instanceType: "t3.2xlarge",
  desiredCapacity: desiredClusterCapacity,
  minSize: 1,
  maxSize: 5,
  providerCredentialOpts: {
    profileName: aws.config.profile,
  },
  roleMappings: [
    {
      groups: ["system:masters"],
      roleArn: kubeAdminRoleARN,
      username: "admin",
    },
  ],
  vpcId: vpc.id,
  publicSubnetIds: vpc.publicSubnetIds,
  privateSubnetIds: vpc.privateSubnetIds,
})

const teztnetsHostedZone = new aws.route53.Zone("teztnets.xyz", {
  comment: "Teztnets Hosted Zone",
  forceDestroy: false,
  name: "teztnets.xyz",
})

/**
 * Top level A records points to github pages
 * see: "configure an apex domain"
 * https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
 */
const teztnetsRootRecords = new aws.route53.Record("teztnetsRootRecords", {
  zoneId: teztnetsHostedZone.zoneId,
  name: "teztnets.xyz",
  type: "A",
  ttl: 300,
  records: [
    "185.199.108.153",
    "185.199.109.153",
    "185.199.110.153",
    "185.199.111.153",
  ],
})

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig
export const clusterName = cluster.eksCluster.name
export const clusterNodeInstanceRoleName = cluster.instanceRoles.apply(
  (roles) => roles[0].name
)

deployAwsAlbController(cluster)
deployExternalDns(cluster)

const periodicCategory = "Periodic Teztnets"
const protocolCategory = "Protocol Teztnets"
const longCategory = "Long-running Teztnets"

// chains
const dailynet_chain = new TezosChain(
  new TezosChainParametersBuilder({
    yamlFile: "dailynet/values.yaml",
    dnsName: "dailynet",
    category: periodicCategory,
    humanName: "Dailynet",
    description:
      "A testnet that restarts every day launched from tezos/tezos master branch and protocol alpha.",
    schedule: "0 0 * * *",
    bootstrapContracts: ["taquito_big_map_contract.json", "taquito_contract.json", "taquito_sapling_contract.json", "taquito_tzip_12_16_contract.json"],
    chartRepo: "https://oxheadalpha.github.io/tezos-helm-charts/",
    chartRepoVersion: "6.7.0",
    privateBakingKey: private_oxhead_baking_key,
    numberOfFaucetAccounts: 1000,
    faucetSeed: faucetSeed,
    faucetRecaptchaSiteKey: faucetRecaptchaSiteKey,
    faucetRecaptchaSecretKey: faucetRecaptchaSecretKey,
  }),
  cluster.provider,
  repo,
  teztnetsHostedZone,
)

const mondaynet_chain = new TezosChain(
  new TezosChainParametersBuilder({
    yamlFile: "mondaynet/values.yaml",
    dnsName: "mondaynet",
    category: periodicCategory,
    humanName: "Mondaynet",
    description:
      "A testnet that restarts every Monday launched from tezos/tezos master branch. It runs Jakarta with SCORU feature flags on for 8 cycles then upgrades to proto Alpha.",
    schedule: "0 0 * * MON",
    bootstrapPeers: [
      "mondaynet.ecadinfra.com",
    ],
    bootstrapContracts: ["taquito_big_map_contract.json", "taquito_contract.json", "taquito_sapling_contract.json", "taquito_tzip_12_16_contract.json"],
    chartRepo: "https://oxheadalpha.github.io/tezos-helm-charts/",
    chartRepoVersion: "6.7.0",
    privateBakingKey: private_oxhead_baking_key,
    numberOfFaucetAccounts: 1000,
    faucetSeed: faucetSeed,
    faucetRecaptchaSiteKey: faucetRecaptchaSiteKey,
    faucetRecaptchaSecretKey: faucetRecaptchaSecretKey,
  }),
  cluster.provider,
  repo,
  teztnetsHostedZone,
)

const ghostnet_chain = new TezosChain(
  new TezosChainParametersBuilder({
    yamlFile: "ghostnet/values.yaml",
    name: "ghostnet",
    aliases: ["ithacanet"],
    dnsName: "ghostnet",
    category: longCategory,
    humanName: "Ghostnet",
    description: "Ghostnet is the long-running testnet for Tezos",
    bootstrapPeers: [
      "ghostnet.smartpy.io",
      "ghostnet.boot.ecadinfra.com",
      "ghostnet.kaml.fr",
      "ghostnet.stakenow.de:9733",
      "ghostnet.visualtez.com",
    ],
    chartRepo: "https://oxheadalpha.github.io/tezos-helm-charts/",
    chartRepoVersion: "6.7.0",
    privateBakingKey: private_oxhead_baking_key,
    numberOfFaucetAccounts: 10000,
    faucetSeed: faucetSeed,
    faucetRecaptchaSiteKey: faucetRecaptchaSiteKey,
    faucetRecaptchaSecretKey: faucetRecaptchaSecretKey,
    indexers: [
      {
        name: "TzKT",
        url: "https://ghostnet.tzkt.io"
      },
      {
        name: "TzStats",
        url: "https://ghost.tzstats.com"
      },
    ]
  }),
  cluster.provider,
  repo,
  teztnetsHostedZone,
)

const ghostnet_signer = new TezosSigner(
  new TezosSignerParametersBuilder({
    yamlFile: "ghostnet-signer/values.yaml",
    name: "ghostnet-signer",
    privateBakingKey: private_oxhead_baking_key,
  }),
  cluster.provider,
  repo,
  teztnetsHostedZone,
)

const jakartanet_chain = new TezosChain(
  new TezosChainParametersBuilder({
    yamlFile: "jakartanet/values.yaml",
    name: "jakartanet",
    dnsName: "jakartanet",
    category: protocolCategory,
    humanName: "Jakartanet",
    description: "Testnet for the Jakarta protocol proposal, proposed April 2022",
    bootstrapPeers: [
      "jakartanet.boot.ecadinfra.com",
      "jakartanet.kaml.fr",
      "jakartanet.visualtez.com",
    ],
    chartRepo: "https://oxheadalpha.github.io/tezos-helm-charts/",
    chartRepoVersion: "6.7.0",
    privateBakingKey: private_oxhead_baking_key,
    numberOfFaucetAccounts: 10000,
    faucetSeed: faucetSeed,
    faucetRecaptchaSiteKey: faucetRecaptchaSiteKey,
    faucetRecaptchaSecretKey: faucetRecaptchaSecretKey,
    indexers: [
      {
        name: "TzKT",
        url: "https://jakartanet.tzkt.io"
      },
      {
        name: "TzStats",
        url: "https://jakarta.tzstats.com"
      },
    ]
  }),
  cluster.provider,
  repo,
  teztnetsHostedZone,
)

const kathmandunet_chain = new TezosChain(
  new TezosChainParametersBuilder({
    yamlFile: "kathmandunet/values.yaml",
    name: "kathmandunet",
    dnsName: "kathmandunet",
    category: protocolCategory,
    humanName: "Kathmandunet",
    description: "Testnet for the half-baked Kathmandu proposal - not final",
    bootstrapPeers: [
      "kathmandunet.boot.ecadinfra.com",
    ],
    //chartRepo: "https://oxheadalpha.github.io/tezos-helm-charts/",
    //chartRepoVersion: "6.7.0",
    chartPath: 'kathmandunet/tezos-k8s',
    privateBakingKey: private_oxhead_baking_key,
    numberOfFaucetAccounts: 10000,
    faucetSeed: faucetSeed,
    faucetRecaptchaSiteKey: faucetRecaptchaSiteKey,
    faucetRecaptchaSecretKey: faucetRecaptchaSecretKey,
  }),
  cluster.provider,
  repo,
  teztnetsHostedZone,
)

function getNetworks(chains: TezosChain[]): object {
  const networks: { [name: string]: object } = {}

  chains.forEach(function(chain) {
    const bootstrapPeers: string[] = Object.assign([], chain.params.getPeers()) // clone
    bootstrapPeers.splice(0, 0, `${chain.params.getName()}.teztnets.xyz`)

    // genesis_pubkey is the public key associated with the $TEZOS_OXHEAD_BAKING_KEY private key in github secrets
    // TODO: generate it dynamically based on privkey
    let genesisPubkey: string = "edpkuYLienS3Xdt5c1vfRX1ibMxQuvfM67ByhJ9nmRYYKGAAoTq1UC"
    const network = Object.assign(
      {},
      chain.params.helmValues["node_config_network"]
    ) // clone
    network["sandboxed_chain_name"] = "SANDBOXED_TEZOS"
    network["default_bootstrap_peers"] = bootstrapPeers
    network["genesis_parameters"] = {
      values: {
        genesis_pubkey: genesisPubkey,
      },
    }
    if ("activation_account_name" in network) {
      delete network["activation_account_name"]
    }
    if ("block" in network["genesis"] === false) {
      // If block hash not passed, use tezos-k8s convention:
      // deterministically derive it from chain name.
      var input = Buffer.from(network["chain_name"])
      var gbk = blake2b(32).update(input).digest('hex');
      var bytes = Buffer.from('0134' + gbk, 'hex')
      network["genesis"]["block"] = bs58check.encode(bytes);
    }

    networks[chain.params.getName()] = network
  })

  return networks
}

function getTeztnets(chains: TezosChain[]): object {
  const teztnets: { [name: string]: { [name: string]: Object } } = {}

  chains.forEach(function(chain) {
    const chainName = chain.params.getName()
    let faucetUrl

    faucetUrl = `https://teztnets.xyz/${chain.params.getName()}-faucet`
    let rpcUrl = `https://rpc.${chain.params.getName()}.teztnets.xyz`
    teztnets[chain.params.getName()] = {
      chain_name: chain.getChainName(),
      network_url: chain.getNetworkUrl(),
      human_name: chain.params.getHumanName(),
      description: chain.getDescription(),
      docker_build: chain.getDockerBuild(),
      git_ref: chain.getGitRef(),
      protocols: chain.getProtocols(),
      last_baking_daemon: chain.getLastBakingDaemon(),
      faucet_url: faucetUrl,
      category: chain.params.getCategory(),
      rpc_url: rpcUrl,
      masked_from_main_page: chain.params.isMaskedFromMainPage(),
      aliases: chain.params.getAliases(),
      indexers: chain.params.getIndexers(),
    }
  })

  return teztnets
}

export const networks = getNetworks([
  dailynet_chain,
  mondaynet_chain,
  ghostnet_chain,
  jakartanet_chain,
  kathmandunet_chain,
])
export const teztnets = getTeztnets([
  dailynet_chain,
  mondaynet_chain,
  ghostnet_chain,
  jakartanet_chain,
  kathmandunet_chain,
])

const pyrometerChart = new k8s.helm.v2.Chart(
  "pyrometer",
  {
    chart: "pyrometer",
    version: "6.1.0",
    fetchOpts:
    {
      repo: "https://oxheadalpha.github.io/tezos-helm-charts/",
    },
    values: {
      config: {
        "node_monitor": {
          "nodes": Object.keys(networks).map(network => "http://tezos-node-rpc." + network + ":8732"),
        },
        "ui": {
          "enabled": true,
          "host": "0.0.0.0",
          "port": 80,
        },
        "log": {
          "level": "info",
          "timestamp": false
        }
      }
    }
  },
  { providers: { kubernetes: cluster.provider } }
);

const pyrometerDomain = "pyrometer.teztnets.xyz"
const pyrometerCert = new aws.acm.Certificate(
  `${pyrometerDomain}-cert`,
  {
    validationMethod: "DNS",
    domainName: pyrometerDomain,
  },
)
const { certValidation } = createCertValidation(
  {
    cert: pyrometerCert,
    targetDomain: pyrometerDomain,
    hostedZone: teztnetsHostedZone
  },
)

const pyrometerIngressName = `${pyrometerDomain}-ingress`
new k8s.networking.v1beta1.Ingress(
  pyrometerIngressName,
  {
    metadata: {
      name: pyrometerIngressName,
      annotations: {
        "kubernetes.io/ingress.class": "alb",
        "alb.ingress.kubernetes.io/scheme": "internet-facing",
        "alb.ingress.kubernetes.io/healthcheck-path": "/",
        "alb.ingress.kubernetes.io/healthcheck-port": "80",
        "alb.ingress.kubernetes.io/listen-ports": '[{"HTTP": 80}, {"HTTPS":443}]',
        "ingress.kubernetes.io/force-ssl-redirect": "true",
        "alb.ingress.kubernetes.io/actions.ssl-redirect":
          '{"Type": "redirect", "RedirectConfig": { "Protocol": "HTTPS", "Port": "443", "StatusCode": "HTTP_301"}}',
      },
      labels: { app: "pyrometer" },
    },
    spec: {
      rules: [
        {
          host: pyrometerDomain,
          http: {
            paths: [
              {
                path: "/*",
                backend: {
                  serviceName: "pyrometer",
                  servicePort: "http",
                },
              },
            ],
          },
        },
      ],
    },
  },
  { provider: cluster.provider }
)
