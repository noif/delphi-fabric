const caUtil = require('./util/ca')
const helper = require('./helper')
const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')
const fsExtra = require('fs-extra')
const logger = require('./util/logger').new('ca-intermediate')
const caHelper = require('./caHelper')
const setCAAdmin = caHelper.setCAAdmin
const orgName = 'BU'
const globalConfig = require('../config/orgs.json')

const companyConfig = globalConfig
const caService = caHelper.getCaService({ orgName, TLS: companyConfig.TLS })
const CRYPTO_CONFIG_DIR = companyConfig.docker.volumes.MSPROOT.dir
const COMPANY_DOMAIN = companyConfig.domain

const org_domain = `${orgName}.${COMPANY_DOMAIN}`
const orgPath = path.join(CRYPTO_CONFIG_DIR, 'peerOrganizations', org_domain)
const ClientUtil = require('./util/client')

const client = ClientUtil.new()
const intermediateName = 'cityU'

const intermediateID = `${intermediateName}.ca.${org_domain}`
const caRoot = path.join(orgPath, 'ca')
const root = path.join(orgPath, 'ca', 'intermediate', intermediateName)
const passwordFile = `${root}/pwd`

const TLS = companyConfig.TLS
const containerClean = () => {
//	TODO delete and 
}
setCAAdmin(client, { orgName, TLS }).then((adminUser) =>
		caUtil.intermediateCA.register(caService, { enrollmentID: intermediateID, affiliation: orgName }, adminUser)
).then((password) => {
	fsExtra.ensureDirSync(root)
	fs.writeFileSync(passwordFile, password)

	return Promise.resolve(password)
}).catch(err => {
	if (err.toString().includes('"code":0')) {
		logger.warn(err)
		const password = fs.readFileSync(passwordFile).toString()

		//[[{"code":0,"message":"Identity 'peerF' is already registered"}]]
		return Promise.resolve(password)
	} else {
		return Promise.reject(err)
	}
}).then((password) => {

	const fabricConfigServerYaml = `${root}/fabric-ca-server-config.yaml`

	const parentURL = `${TLS ? 'https' : 'http'}://${intermediateID}:${password}@ca.${org_domain}:7054`
	const containerCAHome = '/etc/hyperledger/fabric-ca-server/'
	// ca.BU.Delphi.com-cert.pem
	fsExtra.copySync(`${caRoot}/ca.${org_domain}-cert.pem`, `${root}/ca.${org_domain}-cert.pem`)

	// sign profile: one of config of rootCA .signing.profiles|keys[], to fix NOTE: 500 0 "Certificate signing failure: {"code":5300,"message":"Policy violation request"}"
	// if we want to use another sign profile, set .intermediate.enrollment.profile=<other sign profile> config for intermediate CA

	//TODO identities are hard coded
	const config = {
		affiliations: {
			[orgName]: ['client']
		},

		intermediate: {
			parentserver: {
				url: parentURL
			},
			tls: {
				certfiles: [`${containerCAHome}ca.${org_domain}-cert.pem`]
			}
		},

		registry: {
			identities: [
				{
					name: 'CAadmin',
					pass: 'passwd',
					type: 'client',
					maxenrollments: -1,
					attrs: {
						'hf.Registrar.Roles': 'client,user,peer',
						'hf.Revoker': true,
						'hf.Registrar.DelegateRoles': 'client,user'
					}
				}]

		}
	}

	fs.writeFileSync(fabricConfigServerYaml, yaml.safeDump(config))

	const Dockerode = require('./util/dockerode')

	const intermediatePort = 7056
	const containerName = intermediateID

	//NOTE kill before start
	return Dockerode.util.deleteContainer(containerName).then(() => Dockerode.runNewCA({
		ca: {
			containerName,
			port: intermediatePort, networkName: companyConfig.docker.network
		}
		, version: companyConfig.docker.fabricTag,
		config: { CAHome: root, containerCAHome }
	})).then((container) => {

		require('sleep').msleep(1000)
		//FIXME not working from now on:x509 certificate signed by unknown authority

		const MSPID = `${orgName}MSP` // fixme
		const caUrl = `http://localhost:${intermediatePort}` //TODO intermediate TLS?
		const intermediateCaService = caUtil.new(caUrl)// todo
		return setCAAdmin(client, { orgName, TLS }, intermediateCaService)
//	TODO do NewUserInvoke on intermediate CA

	})
}).catch(err => {logger.error(err)})
