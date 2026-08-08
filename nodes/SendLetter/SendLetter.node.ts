import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow'

import {
  baseUrl,
  cancelLetterRequest,
  describeFailure,
  downloadLetterRequest,
  getLetterRequest,
  isRetryable,
  listLettersRequest,
  quoteRequest,
  sendLetterRequest,
  validateAddressRequest,
  type AddressFields,
  type HttpRequest,
  type Product,
} from './operations'

/** The address fields, reused for the sender and the recipient. */
const addressFields = [
  { displayName: 'Company', name: 'company', type: 'string' as const, default: '' },
  { displayName: 'Name', name: 'name', type: 'string' as const, default: '', required: true },
  { displayName: 'Street', name: 'street', type: 'string' as const, default: '', required: true },
  {
    displayName: 'House Number',
    name: 'number',
    type: 'string' as const,
    default: '',
    required: true,
    description:
      'Kept apart from the street because France prints it first and the Netherlands last',
  },
  { displayName: 'Addition', name: 'addition', type: 'string' as const, default: '' },
  {
    displayName: 'Postal Code',
    name: 'postalCode',
    type: 'string' as const,
    default: '',
    required: true,
  },
  { displayName: 'City', name: 'city', type: 'string' as const, default: '', required: true },
  {
    displayName: 'Province',
    name: 'province',
    type: 'string' as const,
    default: '',
    description: 'Required for Italy and Spain, ignored elsewhere',
  },
  {
    displayName: 'Country',
    name: 'country',
    type: 'string' as const,
    default: 'NL',
    required: true,
    description: 'Two-letter country code, for example NL',
  },
]

export class SendLetter implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'SendLetter',
    name: 'sendLetter',
    icon: 'file:sendletter.svg',
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Send a real, printed letter by post',
    defaults: { name: 'SendLetter' },
    // Literals rather than the NodeConnectionTypes constant: that constant was
    // an enum, then a type, then a differently named object across the n8n
    // versions people actually run self-hosted. The string has been 'main'
    // throughout.
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'sendLetterApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        default: 'letter',
        options: [
          { name: 'Letter', value: 'letter' },
          { name: 'Address', value: 'address' },
          { name: 'Pricing', value: 'pricing' },
        ],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['letter'] } },
        default: 'send',
        options: [
          {
            name: 'Send',
            value: 'send',
            description: 'Print a letter and hand it to the post',
            action: 'Send a letter',
          },
          { name: 'Get', value: 'get', description: 'Read one letter', action: 'Get a letter' },
          {
            name: 'Get Many',
            value: 'list',
            description: 'Read a page of letters',
            action: 'Get many letters',
          },
          {
            name: 'Cancel',
            value: 'cancel',
            description: 'Stop a letter that has not gone out yet',
            action: 'Cancel a letter',
          },
          {
            name: 'Download',
            value: 'download',
            description: 'The letter as printed, or its proof of posting',
            action: 'Download a letter',
          },
        ],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['address'] } },
        default: 'validate',
        options: [
          {
            name: 'Validate',
            value: 'validate',
            description: 'Check an address before sending to it',
            action: 'Validate an address',
          },
        ],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['pricing'] } },
        default: 'quote',
        options: [
          {
            name: 'Quote',
            value: 'quote',
            description: 'What a letter would cost',
            action: 'Quote a letter',
          },
        ],
      },

      // -- send ---------------------------------------------------------
      {
        displayName: 'Content',
        name: 'contentType',
        type: 'options',
        displayOptions: { show: { resource: ['letter'], operation: ['send'] } },
        default: 'text',
        options: [
          { name: 'Text', value: 'text', description: 'Typed here, laid out by us' },
          { name: 'PDF From Binary Field', value: 'binary', description: 'A PDF on the item' },
          { name: 'PDF From URL', value: 'url', description: 'A PDF we fetch' },
        ],
      },
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        typeOptions: { rows: 6 },
        displayOptions: { show: { resource: ['letter'], operation: ['send'], contentType: ['text'] } },
        default: '',
        required: true,
      },
      {
        displayName: 'Input Binary Field',
        name: 'binaryPropertyName',
        type: 'string',
        displayOptions: {
          show: { resource: ['letter'], operation: ['send'], contentType: ['binary'] },
        },
        default: 'data',
        required: true,
      },
      {
        displayName: 'PDF URL',
        name: 'fileUrl',
        type: 'string',
        displayOptions: { show: { resource: ['letter'], operation: ['send'], contentType: ['url'] } },
        default: '',
        required: true,
      },
      {
        displayName: 'Sender',
        name: 'sender',
        type: 'fixedCollection',
        placeholder: 'Add Sender',
        displayOptions: { show: { resource: ['letter'], operation: ['send'] } },
        default: {},
        options: [{ name: 'value', displayName: 'Sender', values: addressFields }],
        description: 'Printed as the return address, and where undeliverable post goes back to',
      },
      {
        displayName: 'Recipient',
        name: 'recipient',
        type: 'fixedCollection',
        placeholder: 'Add Recipient',
        displayOptions: { show: { resource: ['letter'], operation: ['send'] } },
        default: {},
        options: [{ name: 'value', displayName: 'Recipient', values: addressFields }],
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        displayOptions: { show: { resource: ['letter'], operation: ['send'] } },
        default: {},
        options: [
          {
            displayName: 'Product',
            name: 'product',
            type: 'options',
            default: 'standard',
            options: [
              { name: 'Standard', value: 'standard' },
              { name: 'Priority', value: 'priority' },
              { name: 'Registered', value: 'registered' },
            ],
          },
          { displayName: 'Colour', name: 'colour', type: 'boolean', default: false },
          {
            displayName: 'Double Sided',
            name: 'duplex',
            type: 'boolean',
            default: true,
            description: 'Whether to print on both sides of each sheet',
          },
          { displayName: 'Subject', name: 'subject', type: 'string', default: '' },
          {
            displayName: 'Idempotency Key',
            name: 'idempotencyKey',
            type: 'string',
            default: '',
            description:
              'Repeat a run with the same key and the original letter comes back instead of a ' +
              'second envelope. Use something from the data, such as the invoice number.',
          },
        ],
      },

      // -- the rest -----------------------------------------------------
      {
        displayName: 'Letter ID',
        name: 'letterId',
        type: 'string',
        displayOptions: {
          show: { resource: ['letter'], operation: ['get', 'cancel', 'download'] },
        },
        default: '',
        required: true,
      },
      {
        displayName: 'Reason',
        name: 'reason',
        type: 'string',
        displayOptions: { show: { resource: ['letter'], operation: ['cancel'] } },
        default: '',
      },
      {
        displayName: 'Proof of Posting',
        name: 'proof',
        type: 'boolean',
        displayOptions: { show: { resource: ['letter'], operation: ['download'] } },
        default: false,
        description: 'Whether to download the proof bundle instead of the letter',
      },
      {
        displayName: 'Put Output File in Field',
        name: 'binaryPropertyName',
        type: 'string',
        displayOptions: { show: { resource: ['letter'], operation: ['download'] } },
        default: 'data',
        required: true,
      },
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        displayOptions: { show: { resource: ['letter'], operation: ['list'] } },
        default: false,
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        displayOptions: { show: { resource: ['letter'], operation: ['list'], returnAll: [false] } },
        default: 25,
        description: 'Max number of results to return',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        displayOptions: { show: { resource: ['letter'], operation: ['list'] } },
        default: {},
        options: [
          { displayName: 'Status', name: 'status', type: 'string', default: '' },
          {
            displayName: 'Mode',
            name: 'mode',
            type: 'options',
            default: 'live',
            options: [
              { name: 'Live', value: 'live' },
              { name: 'Test', value: 'test' },
            ],
            description: 'Keeps test letters out of a production list',
          },
        ],
      },
      {
        displayName: 'Address',
        name: 'addressToCheck',
        type: 'fixedCollection',
        placeholder: 'Add Address',
        displayOptions: { show: { resource: ['address'], operation: ['validate'] } },
        default: {},
        options: [{ name: 'value', displayName: 'Address', values: addressFields }],
      },
      {
        displayName: 'Destination',
        name: 'destination',
        type: 'string',
        displayOptions: { show: { resource: ['pricing'], operation: ['quote'] } },
        default: 'NL',
        required: true,
        description: 'Two-letter country code',
      },
      {
        displayName: 'Pages',
        name: 'pages',
        type: 'number',
        typeOptions: { minValue: 1 },
        displayOptions: { show: { resource: ['pricing'], operation: ['quote'] } },
        default: 1,
      },
    ],
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const out: INodeExecutionData[] = []

    const credentials = await this.getCredentials('sendLetterApi')
    const base = baseUrl(credentials.baseUrl as string | undefined)

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string
        const operation = this.getNodeParameter('operation', i) as string

        let request: HttpRequest
        let fileName = 'letter.pdf'

        if (resource === 'letter' && operation === 'send') {
          const contentType = this.getNodeParameter('contentType', i) as 'text' | 'binary' | 'url'
          const options = this.getNodeParameter('options', i, {}) as IDataObject

          let fileBase64: string | undefined
          let uploadName: string | undefined
          if (contentType === 'binary') {
            const property = this.getNodeParameter('binaryPropertyName', i) as string
            const binary = this.helpers.assertBinaryData(i, property)
            const buffer = await this.helpers.getBinaryDataBuffer(i, property)
            fileBase64 = buffer.toString('base64')
            uploadName = binary.fileName ?? 'document.pdf'
          }

          request = sendLetterRequest(base, {
            sender: readAddress(this, 'sender', i),
            recipient: readAddress(this, 'recipient', i),
            contentType,
            text: contentType === 'text' ? (this.getNodeParameter('text', i) as string) : undefined,
            fileBase64,
            fileName: uploadName,
            fileUrl:
              contentType === 'url' ? (this.getNodeParameter('fileUrl', i) as string) : undefined,
            subject: options.subject as string | undefined,
            product: options.product as Product | undefined,
            colour: options.colour as boolean | undefined,
            duplex: options.duplex as boolean | undefined,
            idempotencyKey: (options.idempotencyKey as string) || undefined,
          })
        } else if (resource === 'letter' && operation === 'get') {
          request = getLetterRequest(base, this.getNodeParameter('letterId', i) as string)
        } else if (resource === 'letter' && operation === 'list') {
          const returnAll = this.getNodeParameter('returnAll', i) as boolean
          const filters = this.getNodeParameter('filters', i, {}) as IDataObject
          const limit = returnAll ? 100 : (this.getNodeParameter('limit', i) as number)
          request = listLettersRequest(base, {
            limit,
            status: filters.status as string | undefined,
            mode: filters.mode as string | undefined,
          })

          if (returnAll) {
            // Paged here rather than left to the user. Without this the node
            // silently returns the first page and a workflow that reconciles
            // invoices quietly misses everything older.
            let before: string | undefined
            for (;;) {
              const page = (await send(this, {
                ...listLettersRequest(base, {
                  limit,
                  status: filters.status as string | undefined,
                  mode: filters.mode as string | undefined,
                  before,
                }),
              })) as { data?: IDataObject[]; nextCursor?: string | null }
              for (const letter of page.data ?? []) {
                out.push({ json: letter, pairedItem: { item: i } })
              }
              if (!page.nextCursor) break
              before = page.nextCursor
            }
            continue
          }
        } else if (resource === 'letter' && operation === 'cancel') {
          request = cancelLetterRequest(
            base,
            this.getNodeParameter('letterId', i) as string,
            (this.getNodeParameter('reason', i, '') as string) || undefined,
          )
        } else if (resource === 'letter' && operation === 'download') {
          const id = this.getNodeParameter('letterId', i) as string
          const proof = this.getNodeParameter('proof', i) as boolean
          request = downloadLetterRequest(base, id, proof)
          fileName = proof ? `${id}-proof.pdf` : `${id}.pdf`
        } else if (resource === 'address') {
          request = validateAddressRequest(base, readAddress(this, 'addressToCheck', i))
        } else {
          request = quoteRequest(base, {
            destination: this.getNodeParameter('destination', i) as string,
            pages: this.getNodeParameter('pages', i) as number,
          })
        }

        const result = await send(this, request)

        if (request.binary) {
          const buffer = result as unknown as Buffer
          out.push({
            json: { letterId: this.getNodeParameter('letterId', i) },
            binary: {
              [this.getNodeParameter('binaryPropertyName', i) as string]:
                await this.helpers.prepareBinaryData(buffer, fileName, 'application/pdf'),
            },
            pairedItem: { item: i },
          })
        } else if (Array.isArray((result as IDataObject).data)) {
          for (const row of (result as IDataObject).data as IDataObject[]) {
            out.push({ json: row, pairedItem: { item: i } })
          }
        } else {
          out.push({ json: result as IDataObject, pairedItem: { item: i } })
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          })
          continue
        }
        throw error
      }
    }

    return [out]
  }
}

function readAddress(context: IExecuteFunctions, name: string, index: number): AddressFields {
  const raw = context.getNodeParameter(name, index, {}) as { value?: IDataObject }
  const value = (raw.value ?? {}) as unknown as AddressFields
  if (!value.name || !value.street || !value.postalCode || !value.city) {
    throw new NodeOperationError(
      context.getNode(),
      `The ${name} is incomplete. Name, street, postal code and city are all required.`,
      { itemIndex: index },
    )
  }
  return value
}

/**
 * One request, with the refusal turned into something readable.
 *
 * `ignoreHttpStatusErrors` is on so the body of a 4xx is available: that body
 * carries the payment link on an empty wallet and the field-level problems on a
 * bad address, and n8n's default error would throw both away and show a status
 * code.
 */
async function send(context: IExecuteFunctions, request: HttpRequest): Promise<unknown> {
  const response = await context.helpers.httpRequestWithAuthentication.call(
    context,
    'sendLetterApi',
    {
      method: request.method,
      url: request.url,
      body: request.body,
      qs: request.qs,
      json: !request.binary,
      encoding: request.binary ? 'arraybuffer' : undefined,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    },
  )

  const status = (response as { statusCode: number }).statusCode
  const body = (response as { body: unknown }).body

  if (status >= 400) {
    const message = describeFailure(status, body)
    throw new NodeOperationError(
      context.getNode(),
      isRetryable(status) ? `${message} This one is worth retrying.` : message,
      { description: `HTTP ${status}` },
    )
  }

  return body
}
