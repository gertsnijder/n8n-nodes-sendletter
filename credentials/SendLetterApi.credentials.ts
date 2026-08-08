import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow'

export class SendLetterApi implements ICredentialType {
  name = 'sendLetterApi'

  displayName = 'SendLetter API'

  documentationUrl = 'https://sendletter.eu/en/developers'

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'From the account area. A key beginning sk_test_ runs the whole lifecycle, ' +
        'webhooks included, without printing, posting or charging anything.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://onlinebriefversturen.nl',
      description: 'Only change this to point at a preview deployment.',
    },
  ]

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  }

  /**
   * Pressing "test" has to fail on a wrong key and succeed on a right one, so
   * it goes at something that needs the key and changes nothing. Quoting would
   * pass without any credential at all, which is worse than no test: it tells
   * somebody their typo is fine.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl || "https://onlinebriefversturen.nl"}}',
      url: '/api/v1/letters',
      qs: { limit: 1 },
    },
  }
}
