---
layout: page
title: Kathmandunet
permalink: /kathmandunet-about
---

Testnet for the half-baked Kathmandu proposal - not final

| | |
|-------|---------------------|
| Full network name | `TEZOS_KATHMANDUNET_2022-06-30T15:00:00Z` |
| Tezos docker build | [tezos/tezos:master_43d54ff6_20220629174233](https://hub.docker.com/r/tezos/tezos/tags?page=1&ordering=last_updated&name=master_43d54ff6_20220629174233) |
| Public RPC endpoint | [https://rpc.kathmandunet.teztnets.xyz](https://rpc.kathmandunet.teztnets.xyz) |
| Faucet | [Kathmandunet faucet](https://teztnets.xyz/kathmandunet-faucet) |
| Activated on | 2022-06-30T15:00:00Z |
| Protocol at level 8192 |  `PtKathmaHPSjL3WDmUCJP7iHBsUix65HdAgSeVacukogRK6hum6` |


Half-baked Kathmandu protocol snapshot. The real one will come later. PLEASE DO NOT INJECT.

There is no Octez release for this first instance of Kathmandunet. You need to build or grab a build or container from the master branch of Octez built on or after `Wed Jun 29 17:42:33 2022 +0000` (commit `43d54ff63d`).

But the protocol is already snapshotted. The baker binary for this protocol is `tezos-baker-014-PtKathma`. Do not run the "alpha" baker, it will not work.

Kathmandunet will run Jakarta for the first 2 cycles and then update to Kathmandu, so you also need to run the Jakarta baker at first.

You need to opt-in to be a bootstrap baker, by submitting a PR against [this file in the teztnets repo](https://github.com/oxheadalpha/teztnets/blob/main/kathmandunet/values.yaml) or making yourself known in the baking slack #test-networks channel.


### Install the software

⚠️  If you already have an existing Tezos installation, do not forget to backup and delete your `~/.tezos-node` and `~/.tezos-client`.



#### Alternative: Use docker

To join Kathmandunet with docker, open a shell in the container:

```
docker run -it --entrypoint=/bin/sh tezos/tezos:master_43d54ff6_20220629174233
```

#### Alternative: Build the software

⚠️  If this is your first time installing Tezos, you may need to [install a few dependencies](https://tezos.gitlab.io/introduction/howtoget.html#setting-up-the-development-environment-from-scratch).

```
git clone git@gitlab.com:tezos/tezos.git
cd tezos
git checkout 43d54ff6
opam init # if this is your first time using OPAM
make build-deps
eval $(opam env)
make
export PATH=$HOME/tezos/_build/install/default/bin/:$PATH
```

### Join the Kathmandunet network

Run the following commands:

```
tezos-node config init --network https://teztnets.xyz/kathmandunet

tezos-node run --rpc-addr 127.0.0.1:8732
```

> 💡 A simple way to keep your process alive is to use `screen` or `nohup` to keep it running in the background while redirecting logs into files at the same time. For example:
>
> ```bash=13
> nohup tezos-node run --rpc-addr 127.0.0.1:8732 > ./node-kathmandunet.log &
> ```


### Bake on the Kathmandunet network

To improve reliability of the chain, you can take part in the consensus by becoming a baker. In that case, you will need some test tokens from the [faucet](https://teztnets.xyz/kathmandunet-faucet).

If you are not a bootstrap baker, you need to register your key as a delegate using your alias or `pkh`. For instance:
```bash=2
./tezos-client register key faucet as delegate
```

You may now launch the baker process.
```bash=3
tezos-baker-014-PtKathma run with local node ~/.tezos-node faucet
```

You may run the accuser as well:
```bash=3
tezos-accuser-014-PtKathma run
```

> 💡 Again, to keep your processes alive in background:
>
> ```bash=4
> nohup tezos-baker-014-PtKathma run with local node ~/.tezos-node faucet > ./baker-kathmandunet.log &
> ```

Note that you need a minimum amount of tez to get baking rights. If you are not a bootstrap baker, it will take you several cycles to start baking.


