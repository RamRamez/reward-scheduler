const config = {
    TARGET_URL: 'https://api.sample.com/reward',
    REQUEST_BODY: {
        sampleCampaign: 'sample:campaign:link',
    },
    TARGET_TIMES: [ // HH:MM:SS
        '19:59:59',
        '20:00:00',
        '20:00:01',
        '20:00:02',
        '20:00:03',
        '20:00:04',
        '20:00:05',
    ],
    TOKENS: [
        'TOKEN_1',
        'TOKEN_2',
    ],
    ORIGIN: 'https://sample.com/',
}

export default config