// SHA-256 outputs of the pure-JS `sha256Js` as it shipped on main 44af9a4,
// recorded BEFORE it was replaced by `@noble/hashes` (issue #301). The
// replacement must give the same bytes for every one of them. Generated
// data; do not edit by hand.

/** the deterministic input of a vector: `len` bytes from a fixed LCG seeded with `seed` */
export function baselineBytes(len: number, seed: number): Uint8Array {
  const b = new Uint8Array(len)
  let x = seed >>> 0
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    b[i] = x >>> 24
  }
  return b
}

export const SHA256_VECTORS: readonly { len: number; seed: number; hex: string }[] = [
  {
    "len": 0,
    "seed": 1,
    "hex": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  {
    "len": 1,
    "seed": 2,
    "hex": "dabd3aff769f07eb2965401eb029974ebba3407afd02b26ddb564ea5f8efae72"
  },
  {
    "len": 2,
    "seed": 3,
    "hex": "da569f54ddcd3ca7fce75cd0f34eedbc2a678552a9beade80f6b870c9a61e394"
  },
  {
    "len": 3,
    "seed": 4,
    "hex": "8c808a42f2c0c4c29dfb4e59c0053d5fb83ee9a52e1460cc9e9ff767ef9ec9ee"
  },
  {
    "len": 4,
    "seed": 5,
    "hex": "a75ee86f7df2eacefc7246b557e5854f1e33d393c625a913a1935493d57971de"
  },
  {
    "len": 5,
    "seed": 6,
    "hex": "e995aabaa013c7cc66cec552486d26e3b5cd1bd7525a26757c09f824c9eaae25"
  },
  {
    "len": 6,
    "seed": 7,
    "hex": "e5e4276dcb04f21dc33ac93bda106dde9ef36065a3b17f2d749f486db104e2b4"
  },
  {
    "len": 7,
    "seed": 8,
    "hex": "74a4a388e5d84fb98c031a61ea09d5ce589cfd489ad32bced08358fd3e3ba619"
  },
  {
    "len": 8,
    "seed": 9,
    "hex": "1c7fb01367e51cb60a0486ad10ae283b7cd4cee89b1430187fdc765d961fd0f0"
  },
  {
    "len": 9,
    "seed": 10,
    "hex": "44f994aa2cbb474920513d90ae2a709c17eba4e91d738033f97db89e42340be0"
  },
  {
    "len": 10,
    "seed": 11,
    "hex": "ff797c4023104acff268f7d156faa49c3daa1c12ead5a53b15fe4bb2e43d35f3"
  },
  {
    "len": 11,
    "seed": 12,
    "hex": "a85d3d87853f4d8419663a1a87d8c1feb3da239491b172a2c896fd236efd51c4"
  },
  {
    "len": 12,
    "seed": 13,
    "hex": "0b6950408cf6b6bba501acaa2de833ee14bc95814086735d3d804551c2ecb825"
  },
  {
    "len": 13,
    "seed": 14,
    "hex": "0a196781ea9d7df35ba16cee3cd8615ca08f84d93dc8f8b623bff1a864c43c37"
  },
  {
    "len": 14,
    "seed": 15,
    "hex": "c37f936a51e6e3456fd511d9761e1501f09da571408129f458e4463852cdfa36"
  },
  {
    "len": 15,
    "seed": 16,
    "hex": "29051d1c6bed5a21a25092fb5a86909fb893be05ede5eea7f1f1253d7fb3691e"
  },
  {
    "len": 16,
    "seed": 17,
    "hex": "224f83f0e0ac2adebc7630445d2462dde9cd5bcd49b9b2a213571d5bdbdd19e0"
  },
  {
    "len": 17,
    "seed": 18,
    "hex": "d94ac30df9f0046971aca837716e319c7ffc074c6c320221aa63a1ad478f22dd"
  },
  {
    "len": 18,
    "seed": 19,
    "hex": "a1aed5e910cdaffeb9754260f14894c360078e87dafb4833d685310c687a8342"
  },
  {
    "len": 19,
    "seed": 20,
    "hex": "53522a2528f783e06bcd6a5c04cd3c82c23f7861c39b4474d223ec36bdc1eb91"
  },
  {
    "len": 20,
    "seed": 21,
    "hex": "e4a9f8550166cba7447e2f32145c015595dece5d7367e690f95a11269398a7b2"
  },
  {
    "len": 21,
    "seed": 22,
    "hex": "cdbe860c74d744e71fe0f2958253a955fa4dd2f7c4bebdefdfe0322661501214"
  },
  {
    "len": 22,
    "seed": 23,
    "hex": "79697319b62cf7a84486aa8b277fd1f356a9b188b9f240131e92059d810a29a1"
  },
  {
    "len": 23,
    "seed": 24,
    "hex": "c7bdb08097a9338c2add48abb1541661fec32c548705b2098ebddb4f4346420a"
  },
  {
    "len": 24,
    "seed": 25,
    "hex": "69345b3786be3d0c577abbb10c5a7ac57f312d42fa99d384b55b745d42f7383a"
  },
  {
    "len": 25,
    "seed": 26,
    "hex": "fd9ab3d873c1c013a4312009754d7462d9f1657288cd9891f4b696d48a36e20f"
  },
  {
    "len": 26,
    "seed": 27,
    "hex": "ddf1e47515147523f0dc956bfd57d8db2763fe4bd8bb7cecc14d8cba56203ff3"
  },
  {
    "len": 27,
    "seed": 28,
    "hex": "4dd4b527be8f3790092d82135813e3fa82d41e5694dea3fad5d97ef3a038cae0"
  },
  {
    "len": 28,
    "seed": 29,
    "hex": "5bb465d5e786f6c23d905a58583c0249c0d6b74ba5aa632313f5f89756f46619"
  },
  {
    "len": 29,
    "seed": 30,
    "hex": "fb4228e47a624aeac37422551c54f859408435814337b3672943827ffb6ee7e7"
  },
  {
    "len": 30,
    "seed": 31,
    "hex": "b3cf32b2ff27bc03d0b0048fa39331f71f7a4dfff630b09c617b80aa25dd94b4"
  },
  {
    "len": 31,
    "seed": 32,
    "hex": "cb4cce0dfaf6ee9827c5b3932f61b988ef76e7c0be28c8099b383c5e59797d43"
  },
  {
    "len": 32,
    "seed": 33,
    "hex": "bf7d7747d82eed21b2eb9f159aec979b394ac328a830d66ee5dede5838cee625"
  },
  {
    "len": 33,
    "seed": 34,
    "hex": "e56d5f2ade851b8adf789b186be67d3c093a37096dcbc50c3b9bdcd6ce522de0"
  },
  {
    "len": 34,
    "seed": 35,
    "hex": "85d04b7b605badbeab49608cd412fe20bcc6db7aadf49763a58daa013aa44031"
  },
  {
    "len": 35,
    "seed": 36,
    "hex": "1b13b343ab83f2e6c0e4b16fdf7e7f2126cfb4bc1b8e04601a27d8dbdfdb8fbc"
  },
  {
    "len": 36,
    "seed": 37,
    "hex": "fea7412b78e402a536f6906347183134c8f1304b0f80c67195e3ca59136c24c9"
  },
  {
    "len": 37,
    "seed": 38,
    "hex": "0223138f201f3a670bb6bc06709cb9b8bb199c87e113e12d43ad36d1525cbf55"
  },
  {
    "len": 38,
    "seed": 39,
    "hex": "b4fbf5f7f51b22d9c516910f238ac92e67efa728b18d8672f1f9c79c4ee0d74c"
  },
  {
    "len": 39,
    "seed": 40,
    "hex": "15e148d1d71edd91e599f4aaaa0d756dbd5e7d6cde12f296d25f79d3df322816"
  },
  {
    "len": 40,
    "seed": 41,
    "hex": "e30b381f4aca7355bd08555dc70dc13404b229b65133c8506d29d614241e02e7"
  },
  {
    "len": 41,
    "seed": 42,
    "hex": "c0c414132890f2d0879ebd2e720ded87005edc95fba89c493f19d677d2435e24"
  },
  {
    "len": 42,
    "seed": 43,
    "hex": "436af5cd209b21f5c9ce7e6ec8f173e2ca462d57091531b5e9f80b89be6ed406"
  },
  {
    "len": 43,
    "seed": 44,
    "hex": "f57fcd078c7c59ad1e8bded5317f78ebcaefd067a7e08ed7059274f87c14b580"
  },
  {
    "len": 44,
    "seed": 45,
    "hex": "b4976303b5addc4727bb4361958c37795ea39de8ba6d15452e51ed4d694380e3"
  },
  {
    "len": 45,
    "seed": 46,
    "hex": "df3a032f24431363787624d866a71b382de9c1eb27e89b23ae1964474314332a"
  },
  {
    "len": 46,
    "seed": 47,
    "hex": "9ffd96b815e2a306a31e2438d614c317d1c4dad33c80fd3dc23671b3068e876b"
  },
  {
    "len": 47,
    "seed": 48,
    "hex": "496a9d596f7126452bbbcce3b26eb7c2793068e537c00c7d23eb0552dcf3c806"
  },
  {
    "len": 48,
    "seed": 49,
    "hex": "24b9e08867a1a643c70d96e7e63e5a2f74149a97c82ab21dce5d19135c611eff"
  },
  {
    "len": 49,
    "seed": 50,
    "hex": "c3b07a134959094dec7fa2d9447f2677d98d2c4912e8cbbc2649910539856ae3"
  },
  {
    "len": 50,
    "seed": 51,
    "hex": "5a06381ce563f98884e48133d46c5dfda15b904d4eb65699cc289a9fa3a0a93f"
  },
  {
    "len": 51,
    "seed": 52,
    "hex": "86480ff013cdd5b7d2cf1b44db6a4743f80e70d1ab09a47045a20cd9a3da35cb"
  },
  {
    "len": 52,
    "seed": 53,
    "hex": "37784c605c7551f44b430bea72a7009dbfd3779486b34be6361c87b5777202c4"
  },
  {
    "len": 53,
    "seed": 54,
    "hex": "ed13c3291067a53e38c390445e6f29c89c48c960516c40d545494762b0fc8ebe"
  },
  {
    "len": 54,
    "seed": 55,
    "hex": "806d26e32c290ce386540f7b1edf28f6deaa025890016034918d58e4f81e561a"
  },
  {
    "len": 55,
    "seed": 56,
    "hex": "f044de87773475849da05199198c86f4a6dc983f3f91527eda56049e0ab21146"
  },
  {
    "len": 56,
    "seed": 57,
    "hex": "4069255bff446e28f0a5bcd961b388732b3b58fb99cb49f101d8bec9047afc13"
  },
  {
    "len": 57,
    "seed": 58,
    "hex": "06bfb6b915d8829ddf1657aeaee958a6ddc5ddd478d5845ec4dbeb3a00b7692a"
  },
  {
    "len": 58,
    "seed": 59,
    "hex": "6570644b6c3c69c7232a3b9329d4b4615f86777985073df4b814c21829718972"
  },
  {
    "len": 59,
    "seed": 60,
    "hex": "2596dff20e42e6ba415be677b36e8084de3335eea2a3eb56e17dbf3cdc9805b2"
  },
  {
    "len": 60,
    "seed": 61,
    "hex": "bb0802e9b1077a91393f46370f96c348d8923d5dacdb9ef4d0049abd28ee0f04"
  },
  {
    "len": 61,
    "seed": 62,
    "hex": "6bd45d7e22c7101fc2d5d553a1e950f92b43072e5cca3fdb8020ce426812a712"
  },
  {
    "len": 62,
    "seed": 63,
    "hex": "0c7945a7c1457cad1b531fba88fc565c9e86e150b97c4b06d2884876a21f2d8c"
  },
  {
    "len": 63,
    "seed": 64,
    "hex": "3422c503299c94eafd8a5dcedb0549e1dc397c4e2a14af9d9711f7b91986058d"
  },
  {
    "len": 64,
    "seed": 65,
    "hex": "25949f8ce98798d11e8ae4e006acfc632e347eb054957ffcdd9b0052d4d7ccc4"
  },
  {
    "len": 65,
    "seed": 66,
    "hex": "1baed0b79a7134c2e95d49065de2b1bbd69050cca441d8bab07ff076d7f85f23"
  },
  {
    "len": 66,
    "seed": 67,
    "hex": "4e97049c816733865bd8038986001693b91cfb182fccf925fa1825cfba7f4462"
  },
  {
    "len": 67,
    "seed": 68,
    "hex": "cdc3a545280dfbb93fb47d687eaa48517ae81cdcdbc9345e012790089436f2e4"
  },
  {
    "len": 68,
    "seed": 69,
    "hex": "204a975edf0bb7eabf97b8f74b4c54e12497a7d6bab0fc1ffb4441d1f7ad6d84"
  },
  {
    "len": 69,
    "seed": 70,
    "hex": "f0d0e10a33cd6e5b2c57a1a05f70666d47c2fbbb46c9e35b9bffb49f5af79aa0"
  },
  {
    "len": 70,
    "seed": 71,
    "hex": "417da5e6958ff7a3b8cc01e90f359925ac1f0d7621f824477aceb6deb7d6ed8d"
  },
  {
    "len": 71,
    "seed": 72,
    "hex": "ea07bd1618dbe08485d682df10a36f34ab238e16954427be18b724ba8a56e010"
  },
  {
    "len": 72,
    "seed": 73,
    "hex": "7dd1c5e9dbeca00a9af3cd9509a0943a9d46ef9cb39de48107ce9c50ebc4d42c"
  },
  {
    "len": 73,
    "seed": 74,
    "hex": "581f6f0dbdbca755811b34001c4165a6a1b3c1663961d85669d5782f2dab1c86"
  },
  {
    "len": 74,
    "seed": 75,
    "hex": "aa6d438992daaf78586a660c4fac235b1e480502516b932ffae0b002150be517"
  },
  {
    "len": 75,
    "seed": 76,
    "hex": "11625e69216df77c2f57598f02aee2b3acd6bf28f8a353b95f6be71dcaa052ca"
  },
  {
    "len": 76,
    "seed": 77,
    "hex": "469e0a8b3f51860e4fe86cc0643a9281ca807354409b983a6ccbfd747cc4d849"
  },
  {
    "len": 77,
    "seed": 78,
    "hex": "302c511826089be5b019595677806caeab90b945d29b955307515154b2c7fc58"
  },
  {
    "len": 78,
    "seed": 79,
    "hex": "fe76041cb4f557cd359eba07da12a13272f0e31975d42daa2a7c4eb175ff6e41"
  },
  {
    "len": 79,
    "seed": 80,
    "hex": "1284a01b9c4a510bb7e40accd4c3a6eb421cb29ee066f3cea8fa2c02fd683800"
  },
  {
    "len": 80,
    "seed": 81,
    "hex": "5b34c45195561c10c9538ea315f22242de21792ff6a8ba7d8659ae405537ab22"
  },
  {
    "len": 81,
    "seed": 82,
    "hex": "573b548887ef4e4ce2a81c76999098581898c34e1e6c5994fda151126aa45770"
  },
  {
    "len": 82,
    "seed": 83,
    "hex": "673c5411b9083077e2412c99e34d10664e0be688007a453227b1a5313ae2adc1"
  },
  {
    "len": 83,
    "seed": 84,
    "hex": "3e1d6ed787cc4586e04eff7863529040d0f4bce4c75433ee6b4ac13359e55ed9"
  },
  {
    "len": 84,
    "seed": 85,
    "hex": "dad1618a16ed023d474916a78af1d5bbcce9211e8d410eff1c89e26222f48883"
  },
  {
    "len": 85,
    "seed": 86,
    "hex": "03cb5364c4efb17227e4378ab7d0e93e2cce92217cfeb17d2d7d6111b7c1dd66"
  },
  {
    "len": 86,
    "seed": 87,
    "hex": "597f6ed0f780c56fe55c0b62f7d8488e52c634e507e89144b98e2bd5b2836376"
  },
  {
    "len": 87,
    "seed": 88,
    "hex": "4d52f07ec21bb5a19392499a65fb1c3f3a986925fcc283e385fcded2bc86761b"
  },
  {
    "len": 88,
    "seed": 89,
    "hex": "6ff0782272091071ba253001c71ff0ea67eed0f993d2cdbe3284a8383e8af9b3"
  },
  {
    "len": 89,
    "seed": 90,
    "hex": "6baa7eb93997d23e7a2836ee295081e4e3e24c0008ac5cfdf1b4a8be3e4d6673"
  },
  {
    "len": 90,
    "seed": 91,
    "hex": "72d3c8db85ccc01b2d922413da9b34ada062a9c93db833f87ab12f753b540fb2"
  },
  {
    "len": 91,
    "seed": 92,
    "hex": "f9df70466c5065420a8247913422305875af1a05c91ef0a2a35693967206d162"
  },
  {
    "len": 92,
    "seed": 93,
    "hex": "475970a9f0403854b91922e778a6556498422a498de88923c0637072033c4a9c"
  },
  {
    "len": 93,
    "seed": 94,
    "hex": "f495e1192111f4ea2e83ea5dce7c44908fd4c645e2aa2e41a772fcc1773d7fed"
  },
  {
    "len": 94,
    "seed": 95,
    "hex": "3165da2453fb58d5938b245c9555c6ae3404f3af39aec69be569b89c8d14b20f"
  },
  {
    "len": 95,
    "seed": 96,
    "hex": "4f7e0d97d6f30b2b40c718550717ccc7f15f40d36ebbedd0b32367a148c71247"
  },
  {
    "len": 96,
    "seed": 97,
    "hex": "d09eed4d43b8c711dbe49407e1caa4fc5dbdee385e629e9d0510802f1a10b9b4"
  },
  {
    "len": 97,
    "seed": 98,
    "hex": "cc323d07ddce8998ce4483dfe2f29d5b0d8b273c8e958212d3f6b7b76286483a"
  },
  {
    "len": 98,
    "seed": 99,
    "hex": "c8e75f970d21d7ea8b6f9c6f6251f8396fe8113f9ff29b436c4ac7f3363a046b"
  },
  {
    "len": 99,
    "seed": 100,
    "hex": "0f05d7b719c097cf24a4efdab2d82f5cb4069302dec1ebcf5b2d5453da62fd68"
  },
  {
    "len": 100,
    "seed": 101,
    "hex": "fad13691e6ed6645aa7936a2c6ea52dd71d18486a7a8e1717e57ebdd12573f77"
  },
  {
    "len": 101,
    "seed": 102,
    "hex": "07ca6620268a7bb01bbad92aceb627858b3f413baaa784d11994733e442a9231"
  },
  {
    "len": 102,
    "seed": 103,
    "hex": "4ff4d0024023cff317ef938e0e3e9bb61b7856705894575227b4b4e71b8fc7aa"
  },
  {
    "len": 103,
    "seed": 104,
    "hex": "ce65bd87791a54e93b88f7e02bfd9043537beccd8107c16fc5d14a59521a5ecd"
  },
  {
    "len": 104,
    "seed": 105,
    "hex": "7f110ec51570b96fcb9bc396c56e68c53d7232f56ff0225c43827840300ec1f6"
  },
  {
    "len": 105,
    "seed": 106,
    "hex": "12bb5ea46928441a07dea842085478b539e105530ec78372ee8178e986cb480e"
  },
  {
    "len": 106,
    "seed": 107,
    "hex": "712e73ed460e06110cfffd08916fa59a80a7b0d452461ca9b74bdda80a4ecac0"
  },
  {
    "len": 107,
    "seed": 108,
    "hex": "11a1ae258e92212f083d88e1f6b9f93131c4fb91ab4835b44550cc66d0bcbe17"
  },
  {
    "len": 108,
    "seed": 109,
    "hex": "37d5643f93eb508aed9c208082b29da29fc066af209afa17af4a74a388d049de"
  },
  {
    "len": 109,
    "seed": 110,
    "hex": "0842cffb5d17c9a6703468954f76371caee89291958e27d880a288ec38cce291"
  },
  {
    "len": 110,
    "seed": 111,
    "hex": "4726354c5b176a254cf20941b49320d7eb0472b381c6f69b286f3a75b4edf4af"
  },
  {
    "len": 111,
    "seed": 112,
    "hex": "420d628294de9f839d1855535e922ba23411acd93b8cd43d74aa0bd8e0cc05f0"
  },
  {
    "len": 112,
    "seed": 113,
    "hex": "079079cd6ac094b16a63a00a4bd41f3e8d902a9fa900927434f227df60a1359b"
  },
  {
    "len": 113,
    "seed": 114,
    "hex": "d6b5de71fbdd203f55ed0e000f1896c9f219ad9f345ac2a80166bb546dcdc0a8"
  },
  {
    "len": 114,
    "seed": 115,
    "hex": "d23b75e64796d77a79811d8ddfafc1ec7dd587f81a0a2921e385d7df3a91cebd"
  },
  {
    "len": 115,
    "seed": 116,
    "hex": "c2c22cbb63aa17a6ea6ba162852475a5c265f3fb6c8e34b0f7de7deb50443768"
  },
  {
    "len": 116,
    "seed": 117,
    "hex": "fa188b2b88d1c839672f7daa5cd3196300412368efcc8e9f628071ee4051e273"
  },
  {
    "len": 117,
    "seed": 118,
    "hex": "902136c8ec41af581dfd7bf4e1d21a39e0081ce5788bf42012123c7fa68b509a"
  },
  {
    "len": 118,
    "seed": 119,
    "hex": "95ac3c3dad703d7a3f92bd1f09ac71d527cd6b8028b8df89da4554c3ae1c2823"
  },
  {
    "len": 119,
    "seed": 120,
    "hex": "cd4f973f21e01fbfc558f091d7bc4d9ae05928ed7e571b394def626d7fa7138b"
  },
  {
    "len": 120,
    "seed": 121,
    "hex": "a64ad0e780188f6442bad06f4202ef41fd3319ffa1431cefdd5faec5c7021ebe"
  },
  {
    "len": 121,
    "seed": 122,
    "hex": "f65e7df0a23d98d84814770e65f66ac707b13276a1523a5dee3b9629b6d4e0f3"
  },
  {
    "len": 122,
    "seed": 123,
    "hex": "83908858f2e254c0796a27092a6dab6c1533df2e9c1b947495ec37b2b29b25c8"
  },
  {
    "len": 123,
    "seed": 124,
    "hex": "3e48bc7cdbbe659b675dd41d2b7798888033b32c558b0c63f2a9afb95359f09a"
  },
  {
    "len": 124,
    "seed": 125,
    "hex": "4559b8f6dffe20d5d8875c1a2c1796d89e62326cc869829d2972d1e9883ad8f1"
  },
  {
    "len": 125,
    "seed": 126,
    "hex": "2756b5afb46abd311722d4e0d89f757ae0d6b92490a36bea7ca24c10d57b79d2"
  },
  {
    "len": 126,
    "seed": 127,
    "hex": "9b23c74f1b6f24095e375574439b5aad9ed465b933a2d1448dca6a4b9e42b834"
  },
  {
    "len": 127,
    "seed": 128,
    "hex": "5c67c09e1a5a97f83a2abb1a01d3256c8f55750c892e31921109e06b4262e5e4"
  },
  {
    "len": 128,
    "seed": 129,
    "hex": "aa3f2e6ed977c082c38c29229f026d813008a6c898d2cdcb4a610143557e0a70"
  },
  {
    "len": 129,
    "seed": 130,
    "hex": "2ce264308a0e80f93b8ee2008e5993e66886d7faff72bed405639045959fa5ad"
  },
  {
    "len": 130,
    "seed": 131,
    "hex": "4ace2135f0960badf3681a2e4140df4a17f32f7232ff57fa28e04e918b5463e8"
  },
  {
    "len": 131,
    "seed": 132,
    "hex": "cab3fb444bdf134e6668c0effd4d58c50d0edfa310b118978d80f5b7f7854b36"
  },
  {
    "len": 132,
    "seed": 133,
    "hex": "9b1b904dec36d38c1e19e13bf1f4d35a25525a03d76450ffa8f4011a6f34c6cd"
  },
  {
    "len": 133,
    "seed": 134,
    "hex": "e7a50752a7f8f67ed59875b72c6efd4bc5ad2750e4512287bdd7d7568ad91bff"
  },
  {
    "len": 134,
    "seed": 135,
    "hex": "94a9c89c522752858ae9eb29cbaaaa99b5a7e92e40a14ccd8ad1ea60ce17e09e"
  },
  {
    "len": 135,
    "seed": 136,
    "hex": "fc29bf45c7691541dfd50620981332b33cd6c5f38956a703ace14e5a96aaab03"
  },
  {
    "len": 136,
    "seed": 137,
    "hex": "f5b9d4d47afc52be15c94019e75f8f78ddb8c2257a06f7c63ad4310b54de1c06"
  },
  {
    "len": 137,
    "seed": 138,
    "hex": "cf24599dcf2b16d74e7de0627f41e15ba2904674c590cc8e775e2062b45649b2"
  },
  {
    "len": 138,
    "seed": 139,
    "hex": "d914dd0f1b9008feb1dec63c2351faae65351235f9ff09a0add3e5d38a13540f"
  },
  {
    "len": 139,
    "seed": 140,
    "hex": "2a7e25c70b2249489b2a37037becee4eee09bd4fd7510aead7541290f1a11ab6"
  },
  {
    "len": 140,
    "seed": 141,
    "hex": "978bf8188443a6e6d3086865077137922bc588fa6dfe815403f910b3765b0479"
  },
  {
    "len": 141,
    "seed": 142,
    "hex": "c6e1f494c50e19205651b4ceeb201dd8f5fa24eabe9078e79495b6fdcc2f398b"
  },
  {
    "len": 142,
    "seed": 143,
    "hex": "e2ed54c1f3084f49582887acdb79d47105cefe7561741941067cb93ca0570bc3"
  },
  {
    "len": 143,
    "seed": 144,
    "hex": "4fbfc9fc38870971a05111cb838238c9ba148966cf6a76da1947fc54041a6dbf"
  },
  {
    "len": 144,
    "seed": 145,
    "hex": "a1ca1ca554f8c1e1c3c56444b3103d87b3048b1a8abb2f368df85bc369139722"
  },
  {
    "len": 145,
    "seed": 146,
    "hex": "2cb4feda2f2bb8714840390c1b7aee0e113725fb1311901bdad732d001e3411f"
  },
  {
    "len": 146,
    "seed": 147,
    "hex": "e7b41553e30535413d463f88087258a3844e9881e847bc4440b396971eebfa1c"
  },
  {
    "len": 147,
    "seed": 148,
    "hex": "4543a0fac021dd758fc2461c2949cd092eecd6fa640e8f294903db6aa4e6f685"
  },
  {
    "len": 148,
    "seed": 149,
    "hex": "3e07cfaa676638603af67cbe21d2b756363ef9372a343ece4d76f33cf95f34f7"
  },
  {
    "len": 149,
    "seed": 150,
    "hex": "a96e4d5fc3953c7396c5656dabec4d6ab8cc57432b5ac81fca9b244bb4195d93"
  },
  {
    "len": 150,
    "seed": 151,
    "hex": "c25053259e854e4ec9945b6a74e47858cb4a8be857363994e1e9ea2ae9008eb7"
  },
  {
    "len": 151,
    "seed": 152,
    "hex": "e087121607d4ba549d464eb1e82a68c46e2111509a14bab0c53f952a0915e446"
  },
  {
    "len": 152,
    "seed": 153,
    "hex": "8b3f99b309ee35582e2fbafb6fa4c5ebeb1b9e3fb9f18e32516900e2e0253ba6"
  },
  {
    "len": 153,
    "seed": 154,
    "hex": "6ee96159649cd84c48d3d7cef1b43a6b79609c1dbcf0249f7e3cf0aec2bc6a5e"
  },
  {
    "len": 154,
    "seed": 155,
    "hex": "a1416f5bcb1aae212475654f25da37fad5aec9b378bcdd821975d072b63f7a65"
  },
  {
    "len": 155,
    "seed": 156,
    "hex": "8c2ae7ee0a1921cc45251edda4ee3a9e3c1142db81a5438df648fd947b8f848f"
  },
  {
    "len": 156,
    "seed": 157,
    "hex": "e50d43af7912147995bea563bb7edac52672d0d54a51e15f0d6578607d8747b8"
  },
  {
    "len": 157,
    "seed": 158,
    "hex": "e9f43382c04a299bfc8b9269b62b12a1077157be87569b3fd49a23500fd70702"
  },
  {
    "len": 158,
    "seed": 159,
    "hex": "d1a9f5f7471ac29a1bc822eabbc2102cf7ceb7a290900a7c9c33f4e3b0af8434"
  },
  {
    "len": 159,
    "seed": 160,
    "hex": "71c51a2439d3ed7fe724f9aa582558ae9d313d0e8bb6098d6232126a7a5a7db9"
  },
  {
    "len": 160,
    "seed": 161,
    "hex": "8d58d58bc8bccb2c23b19a0abb0d11ead15267a5e8cfba256f4e56bd2a6a76a7"
  },
  {
    "len": 161,
    "seed": 162,
    "hex": "9f1465fbfd03a22c176fd611cd9be5cbac70f8a43cfdd6934870853d19f379b6"
  },
  {
    "len": 162,
    "seed": 163,
    "hex": "a17ed15f28c197c9096655159446f4989f41e6d6e9be3652bff55d8ead7c0831"
  },
  {
    "len": 163,
    "seed": 164,
    "hex": "e098a43303f1d53ac7ea40b0a782f48e1e07eb8cb5242cac8559fc00529424c0"
  },
  {
    "len": 164,
    "seed": 165,
    "hex": "c372e2a09ab5bce91e67fd8bb367eebf38d5a1c3cd48de729cdad483b3ec9089"
  },
  {
    "len": 165,
    "seed": 166,
    "hex": "d210b3691d62119345d217d4352c632bc8f1f772885f17c4ff434d72fcad4e63"
  },
  {
    "len": 166,
    "seed": 167,
    "hex": "8a9833d3dec2250cfc28957a02f210e8263af482a86bf3aa11f2f44f267858d0"
  },
  {
    "len": 167,
    "seed": 168,
    "hex": "0d3a3a9a65ec57f2e59f166c1420d104f783d2c16aa1b5be6e90873191d772bd"
  },
  {
    "len": 168,
    "seed": 169,
    "hex": "48193c35c6167768083c1799822803e0cf6e4368a54d008bfcab35e73768c415"
  },
  {
    "len": 169,
    "seed": 170,
    "hex": "622181e6ae386b8003f50934a1bb7e04447844fc314cd70f25b660ea5e58d5cc"
  },
  {
    "len": 170,
    "seed": 171,
    "hex": "f4e78dfde467904ca2923e7ab0ca0a8581fb77705f968543bee29f2f1fc5b14b"
  },
  {
    "len": 171,
    "seed": 172,
    "hex": "c3a563e4658eae21100e7c9e448af2d4b6ff3e5b24a9fc28c287f015d210d288"
  },
  {
    "len": 172,
    "seed": 173,
    "hex": "e6ad069b9d53f537c36fd752420e7290b222dacf0f4460d5201549060a8ef8a9"
  },
  {
    "len": 173,
    "seed": 174,
    "hex": "a34178a31b392d28f0e7510ccc5c979c9a95d05a0c1073c526fcdc9b50aad0be"
  },
  {
    "len": 174,
    "seed": 175,
    "hex": "4f1f1f02a9bc0823505f47658f4aa9f9c9be2c917b3534b282f03f96a18628c9"
  },
  {
    "len": 175,
    "seed": 176,
    "hex": "86bab8facc6261dd55cdcba4c10d05dbac0ca15c2a7f9783657629326dfaf63a"
  },
  {
    "len": 176,
    "seed": 177,
    "hex": "fece28702781d07e1bf246a6f3917ede52d4b55b971cb9d9b50a88be3a0940c1"
  },
  {
    "len": 177,
    "seed": 178,
    "hex": "c77a1bf67fd92452a8629e9e602bc08ca5afe81c3a57192130701bd1f5289c80"
  },
  {
    "len": 178,
    "seed": 179,
    "hex": "8d1adb82b524a9d80937ca61c7f92a81c76dd5fa382cfef7735ab669a2c49f21"
  },
  {
    "len": 179,
    "seed": 180,
    "hex": "6995df2e41902b0524265e32f7c0915148b6a50a82f307b5cc7ee759712bc65a"
  },
  {
    "len": 180,
    "seed": 181,
    "hex": "927c84984b9ae3a050a3335df763a37bf574ee0795157f357eb02e72390dd656"
  },
  {
    "len": 181,
    "seed": 182,
    "hex": "f9f6f777aacecba62c29829305ec114135f131446773342d65d28daa507f82a1"
  },
  {
    "len": 182,
    "seed": 183,
    "hex": "80fb1f8af2aad6660ec63cd18d281adc06f45a13c85647e864c9db495475532c"
  },
  {
    "len": 183,
    "seed": 184,
    "hex": "86bbb956e5e12395d3b98b77862ab675a603077e013412f0c81f37c7f5f95872"
  },
  {
    "len": 184,
    "seed": 185,
    "hex": "1f016f5c66ca5a3ceed449b44d804de7f708e4d4ddff306a48d376d48ec15f21"
  },
  {
    "len": 185,
    "seed": 186,
    "hex": "381bd6aa9895b987ed8f37d65d9d1ca56f5cdc21a251ac22fcf3440ce6cd2373"
  },
  {
    "len": 186,
    "seed": 187,
    "hex": "be0fafdfbe5675c2ed4b33e440cd56b00f525c7ec1060aea577abf8b2f440842"
  },
  {
    "len": 187,
    "seed": 188,
    "hex": "c4c525872e3fe89f94c90e61e259b01a17143acfa98ea6ea9ffe254c31dc4429"
  },
  {
    "len": 188,
    "seed": 189,
    "hex": "ee46e10986d5e8002b4cdb0592c212df125a5fc26703ac73f8d163c6fc4f74ad"
  },
  {
    "len": 189,
    "seed": 190,
    "hex": "6b7c449c3c4462d51f8c0235d82bc1d43622767cfc8878a567c74872eec96856"
  },
  {
    "len": 190,
    "seed": 191,
    "hex": "d373e279a9a9cf091aaa65365fa8a72725bbcd8f3cca22af3a72d15537d92bd6"
  },
  {
    "len": 191,
    "seed": 192,
    "hex": "f148db0875cfd36dbc8041c2e5ec2e632f34b7becb4359d8c0e00f4cf6afce4c"
  },
  {
    "len": 192,
    "seed": 193,
    "hex": "9d855049eb39fef0cbc9bf94ae1dd5ccf7f245f4a11f68e2550c7edf602a81f1"
  },
  {
    "len": 193,
    "seed": 194,
    "hex": "cd0c289a38aaf3cf9972a0001d3b94a4d0415d10bc414b39e1784920c92c518f"
  },
  {
    "len": 194,
    "seed": 195,
    "hex": "b5c3e26e5f4f351f00b16625b3738a8b4356ac4ff8d08da787633f4d4cd75bfd"
  },
  {
    "len": 195,
    "seed": 196,
    "hex": "1cb69e639d584a5cd5337803d2c018c5b63b110b316ca849d3535730119ec0f5"
  },
  {
    "len": 196,
    "seed": 197,
    "hex": "3d010c756c67cd3dbec81721619537ff41a190e6b18bfb491aa40b08153d564b"
  },
  {
    "len": 197,
    "seed": 198,
    "hex": "9bfc485ff7ece41f15bdfe3d5828ed8e1aade5b02e505f8e8c5be8bb3b90304f"
  },
  {
    "len": 198,
    "seed": 199,
    "hex": "0c5d5eb0b41836a5f53517c082450143eac59cd79ed6c43b51ae51ce4f7cd34f"
  },
  {
    "len": 199,
    "seed": 200,
    "hex": "c6b50f5474ef8de46d23775e3c43e7b4fd7e75cca6c5f9ee0a3c8299ffda6b9c"
  },
  {
    "len": 200,
    "seed": 201,
    "hex": "0e768696d633d7fe577f37b3bc6c6fe4f69b58deba0bd385cb18ca84066c5226"
  },
  {
    "len": 1000,
    "seed": 1001,
    "hex": "7c5fe8aa3a3570468d239578fadc553214c1c43e88c427eecc1aad12499df9a1"
  },
  {
    "len": 4096,
    "seed": 4097,
    "hex": "12e8f7728691115fd4d908bbcfaa0458acfb6ef9bf275cacb3c2255066f95022"
  },
  {
    "len": 65536,
    "seed": 65537,
    "hex": "03a1c878361d454763c421f48df1d45e5305cbe1790ee714228c5f8a2de71226"
  },
  {
    "len": 1048576,
    "seed": 1048577,
    "hex": "64e194c2184733175d87f915d3ece2fbd3e68f7954bb959e6bd66c01a99b6b1f"
  }
]

export const SHA256_PUBLISHED: readonly { text: string; hex: string }[] = [
  {
    "text": "",
    "hex": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  {
    "text": "abc",
    "hex": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  },
  {
    "text": "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "hex": "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  },
  {
    "text": "'a' x 1000000",
    "hex": "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
  }
]

export const EXAMPLE_GRAPH_DIGESTS: readonly { file: string; graph: boolean; modelVersion?: number; semanticDigest?: string; contentDigest?: string; fullContentDigest?: string }[] = [
  {
    "file": "coffee-roastery.json",
    "graph": true,
    "modelVersion": 2,
    "semanticDigest": "5b174d6a54bdcbf1c60e5651ec47031b4905b4cf99c0bb7305d2b875e22e113e",
    "contentDigest": "a9d63f3b7562e88a7dc842a5966085839c870e79621ad8d70e60cbb8b9c82c87",
    "fullContentDigest": "a9d63f3b7562e88a7dc842a5966085839c870e79621ad8d70e60cbb8b9c82c87"
  },
  {
    "file": "deadlock.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "4eae1a59299a8f7f54ec5ae07f87b4c5980bff829f578ad32077ce76dcca25f3",
    "contentDigest": "d944dd4bb1bd26ed3a90ec2b3390d938d36e52b33516a69d097370b2208366cc",
    "fullContentDigest": "d944dd4bb1bd26ed3a90ec2b3390d938d36e52b33516a69d097370b2208366cc"
  },
  {
    "file": "engine-b-verification.expected.json",
    "graph": false
  },
  {
    "file": "engine-b-verification.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "8556468a2cf5f9e84991152c5dfa4abdb3f2473ca72e6d1eea26020ada41c908",
    "contentDigest": "39471122530d9b004873fff59e3fa30dad2a6b8bca79e5b7eacc635b9a5dd07a",
    "fullContentDigest": "39471122530d9b004873fff59e3fa30dad2a6b8bca79e5b7eacc635b9a5dd07a"
  },
  {
    "file": "equilibrium.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "1a929be61853177d97a81f0d68a18628919ae6f2581d5802b718d3bc5499fbb6",
    "contentDigest": "10711fd761d4f739fe9a797b46275b44e1f85fef48c751238c55cc7e74ce4826",
    "fullContentDigest": "10711fd761d4f739fe9a797b46275b44e1f85fef48c751238c55cc7e74ce4826"
  },
  {
    "file": "gacha-banner-zones.json",
    "graph": true,
    "modelVersion": 2,
    "semanticDigest": "04fd52f0da05e87fe2e6ba9359546ebb8f3b652c742a9420d03e0eb89c9720e7",
    "contentDigest": "699cfd4908353ca7d5c05e728780585c461d40854d28f1207abe5b72fb62503a",
    "fullContentDigest": "699cfd4908353ca7d5c05e728780585c461d40854d28f1207abe5b72fb62503a"
  },
  {
    "file": "mmo-progression.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "2433dfdf4342924cdd9872fa87cc2b5bf33c0d7c5fa5196d016d97281cfcafaf",
    "contentDigest": "d87e4307c6bce4361cbfcc6d1b40413773c0615633dec86be909a0c30651f746",
    "fullContentDigest": "d87e4307c6bce4361cbfcc6d1b40413773c0615633dec86be909a0c30651f746"
  },
  {
    "file": "model-verification.expected.json",
    "graph": false
  },
  {
    "file": "model-verification.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "3b3433867731ee7680d07f269512e2c1fa57cdcfba79d971b3f5d57e1cddfc9f",
    "contentDigest": "5023c8ab7e80a6cf5c9966fa75adfc07d4991f3b723606da8a1724abeae01ce2",
    "fullContentDigest": "5023c8ab7e80a6cf5c9966fa75adfc07d4991f3b723606da8a1724abeae01ce2"
  },
  {
    "file": "module-buffered-step.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "3c71687ec601d932d2ddacf14e686d330fb3dbc627641f11a9a98ffddd01ffee",
    "contentDigest": "79ab1531c497075be0972c62a212519a4e23e770298cbf17a00e6a86767ffec2",
    "fullContentDigest": "79ab1531c497075be0972c62a212519a4e23e770298cbf17a00e6a86767ffec2"
  },
  {
    "file": "module-reward-split.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "1e9d5ad8a18c3269a0ebe637a243fa05903a22e95447e82350984e93d95d732d",
    "contentDigest": "0538f40b5ffd39a2e66f637afae1ca770aad781838a0d733bdb5f3755d79b017",
    "fullContentDigest": "0538f40b5ffd39a2e66f637afae1ca770aad781838a0d733bdb5f3755d79b017"
  },
  {
    "file": "playback-choreography.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "b004b576b25a41c8da2becfb79e84c49b6e5e90ae28e6f6f6e5521e1096c129c",
    "contentDigest": "47342738c43a8bddbfdfe07cde0e2cfa5df68b744000060732e40c988c3b5c97",
    "fullContentDigest": "47342738c43a8bddbfdfe07cde0e2cfa5df68b744000060732e40c988c3b5c97"
  },
  {
    "file": "risky-factory.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "41a21a02a1bd936160cf5db3d3e5064b13b65c968c4ffefdbcef233fa9fd4641",
    "contentDigest": "76f4a6a98749fbd93bc3ec2c22d8b3d7aa990b1e905fb8064aa4c8c0d83e792b",
    "fullContentDigest": "76f4a6a98749fbd93bc3ec2c22d8b3d7aa990b1e905fb8064aa4c8c0d83e792b"
  },
  {
    "file": "state-verification.expected.json",
    "graph": false
  },
  {
    "file": "state-verification.json",
    "graph": true,
    "modelVersion": 1,
    "semanticDigest": "51adc0ac64a74c52daf87467905efaac40ee3a0e4d3af99c4d2b0f1bff0e9314",
    "contentDigest": "bc2afa9ef52e5570e5da894fc4b7ef8cb83916b126a8949030f8b3f20d2284a3",
    "fullContentDigest": "bc2afa9ef52e5570e5da894fc4b7ef8cb83916b126a8949030f8b3f20d2284a3"
  }
]

export const EXAMPLE_REVISION_READS: readonly Record<string, unknown>[] = [
  {
    "file": "revision/base.revision.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "e490f996091cbb9e3875f83669e369240f882540421b141f6aa43db093da7617",
    "storedBaseDigest": null,
    "sideDigest": "e490f996091cbb9e3875f83669e369240f882540421b141f6aa43db093da7617",
    "projectContentDigest": null,
    "proposalBaseDigest": null,
    "sideMatchesStored": true
  },
  {
    "file": "revision/proposal.clean.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "cb6b4c226cdffe1a2009394a50e539c91057a88b522f3b426c904e372e9f577d",
    "storedBaseDigest": "e490f996091cbb9e3875f83669e369240f882540421b141f6aa43db093da7617",
    "sideDigest": "cb6b4c226cdffe1a2009394a50e539c91057a88b522f3b426c904e372e9f577d",
    "projectContentDigest": null,
    "proposalBaseDigest": "e490f996091cbb9e3875f83669e369240f882540421b141f6aa43db093da7617",
    "sideMatchesStored": true
  },
  {
    "file": "revision/proposal.structural.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "891f76715613fed6718f97cf2c41548e3f196b7d724c9baea6c7e6387379ee1a",
    "storedBaseDigest": "e490f996091cbb9e3875f83669e369240f882540421b141f6aa43db093da7617",
    "sideDigest": "891f76715613fed6718f97cf2c41548e3f196b7d724c9baea6c7e6387379ee1a",
    "projectContentDigest": null,
    "proposalBaseDigest": "e490f996091cbb9e3875f83669e369240f882540421b141f6aa43db093da7617",
    "sideMatchesStored": true
  },
  {
    "file": "revision-legacy-v0.10.0/LP0.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "1569a0853058e20fdb14997a197ec8908ee60db09335d73d35d20618e7790d41",
    "storedBaseDigest": "76d9ad5c3679a3b8feabe090fda28a76fdc8c081165ec38fdab1282b20ef0906",
    "sideDigest": "1569a0853058e20fdb14997a197ec8908ee60db09335d73d35d20618e7790d41",
    "projectContentDigest": null,
    "proposalBaseDigest": "76d9ad5c3679a3b8feabe090fda28a76fdc8c081165ec38fdab1282b20ef0906",
    "sideMatchesStored": true
  },
  {
    "file": "revision-legacy-v0.10.0/LP1.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "ed58f6fb4425479a47bf2cf1216b56f7d71dc259f0f979e77eb406e5d091c890",
    "storedBaseDigest": "76d9ad5c3679a3b8feabe090fda28a76fdc8c081165ec38fdab1282b20ef0906",
    "sideDigest": "ed58f6fb4425479a47bf2cf1216b56f7d71dc259f0f979e77eb406e5d091c890",
    "projectContentDigest": null,
    "proposalBaseDigest": "76d9ad5c3679a3b8feabe090fda28a76fdc8c081165ec38fdab1282b20ef0906",
    "sideMatchesStored": true
  },
  {
    "file": "revision-legacy-v0.10.0/LR0.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "1569a0853058e20fdb14997a197ec8908ee60db09335d73d35d20618e7790d41",
    "storedBaseDigest": null,
    "sideDigest": "1569a0853058e20fdb14997a197ec8908ee60db09335d73d35d20618e7790d41",
    "projectContentDigest": null,
    "proposalBaseDigest": null,
    "sideMatchesStored": true
  },
  {
    "file": "revision-v3/proposal.malformed-base.json",
    "ok": false,
    "stage": "project",
    "storedContentDigest": "5b67acd2cc6329303ffb64967b545457fccccbdf4d1e589a146916cbeb11a0c3",
    "storedBaseDigest": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  },
  {
    "file": "revision-v3/proposal.malformed-proposed.json",
    "ok": true,
    "stage": null,
    "storedContentDigest": "5b67acd2cc6329303ffb64967b545457fccccbdf4d1e589a146916cbeb11a0c3",
    "storedBaseDigest": "b068ddc5c93123f5740148bb5cf428488584cbbca8ded04a94ab1b08a9e58572",
    "sideDigest": "5b67acd2cc6329303ffb64967b545457fccccbdf4d1e589a146916cbeb11a0c3",
    "projectContentDigest": null,
    "proposalBaseDigest": "b068ddc5c93123f5740148bb5cf428488584cbbca8ded04a94ab1b08a9e58572",
    "sideMatchesStored": true
  }
]
