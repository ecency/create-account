module.exports = {
  creators: ['ecency', 'good-karma', 'esteemapp'],
  privateKeys: ['5Jxyz', '5Jyxz', '5Kzyx'],
  authCodes: ['aaa', 'bbb', 'ccc'],
  delegate: '0 VESTS', //'9500.123456 VESTS' for ~5HP, '19000.246912 VESTS' for ~10HP
  premiumAccounts: Boolean(parseInt(process.env.PREM, 10)),
  walletAccounts: Boolean(parseInt(process.env.WALL, 10)),
}
