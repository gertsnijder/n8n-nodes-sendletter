import {
  NodeOperationError,
  type IDataObject,
  type IHookFunctions,
  type INodeType,
  type INodeTypeDescription,
  type IWebhookFunctions,
  type IWebhookResponseData,
} from 'n8n-workflow'
import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  baseUrl,
  listWebhooksRequest,
  signatureMatches,
  subscribeRequest,
  unsubscribeRequest,
} from './operations'

/**
 * Starts a workflow when a letter changes status.
 *
 * A REST hook rather than polling: the status of a letter changes a handful of
 * times over several days, and polling for that means thousands of requests to
 * catch six events, most of them at night when nothing happens.
 *
 * The signature check below is the reason this node exists rather than a
 * generic Webhook node. A generic webhook is an open URL: anyone who learns it
 * can tell the workflow a letter was delivered, and "delivered" is what closes
 * a legal deadline in half the workflows this will be used for.
 */
export class SendLetterTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'SendLetter Trigger',
    name: 'sendLetterTrigger',
    icon: 'file:sendletter.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: 'Starts the workflow when a letter is printed, posted, delivered or refunded',
    defaults: { name: 'SendLetter Trigger' },
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'sendLetterApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['letter.delivered'],
        description: 'Leave empty for every event',
        options: [
          { name: 'Submitted', value: 'letter.submitted' },
          { name: 'Printed', value: 'letter.printed' },
          { name: 'Posted', value: 'letter.posted' },
          { name: 'Delivered', value: 'letter.delivered' },
          { name: 'Failed', value: 'letter.failed' },
          { name: 'Refunded', value: 'letter.refunded' },
        ],
      },
    ],
  }

  webhookMethods = {
    default: {
      /**
       * Whether the subscription this workflow made is still there.
       *
       * Matched on the URL, not on the stored id. n8n keeps static data per
       * workflow, and a restored backup or a duplicated workflow carries an id
       * that belongs to somebody else's subscription; deleting on that id later
       * would switch off a different customer's trigger.
       */
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const credentials = await this.getCredentials('sendLetterApi')
        const base = baseUrl(credentials.baseUrl as string | undefined)
        const target = await this.getNodeWebhookUrl('default')

        const response = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          'sendLetterApi',
          { ...listWebhooksRequest(base), json: true },
        )) as { data?: { id: string; url: string }[] }

        const found = (response.data ?? []).find((hook) => hook.url === target)
        if (!found) return false

        this.getWorkflowStaticData('node').webhookId = found.id
        return true
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const credentials = await this.getCredentials('sendLetterApi')
        const base = baseUrl(credentials.baseUrl as string | undefined)
        const target = await this.getNodeWebhookUrl('default')
        const events = this.getNodeParameter('events', []) as string[]

        if (!target || target.startsWith('http://')) {
          // n8n's own test URL is http on a local install, and the API refuses
          // anything that is not https. Saying so here beats a 400 that reads
          // like the credential is wrong.
          throw new NodeOperationError(
            this.getNode(),
            'SendLetter only delivers to https addresses. Use a tunnel or a hosted n8n for this trigger.',
          )
        }

        const response = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          'sendLetterApi',
          { ...subscribeRequest(base, target, events), json: true },
        )) as { id?: string; secret?: string }

        if (!response.id || !response.secret) return false

        const data = this.getWorkflowStaticData('node')
        data.webhookId = response.id
        // Kept because every callback is verified against it. Subscribing again
        // returns the same secret, so re-activating a workflow does not orphan
        // the receiver.
        data.secret = response.secret
        return true
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node')
        const id = data.webhookId as string | undefined
        if (!id) return true

        const credentials = await this.getCredentials('sendLetterApi')
        const base = baseUrl(credentials.baseUrl as string | undefined)

        try {
          await this.helpers.httpRequestWithAuthentication.call(this, 'sendLetterApi', {
            ...unsubscribeRequest(base, id),
            json: true,
          })
        } catch {
          // Already gone is the outcome we wanted. Failing here would leave the
          // workflow unable to be deactivated.
        }

        delete data.webhookId
        delete data.secret
        return true
      },
    },
  }

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject()
    const secret = this.getWorkflowStaticData('node').secret as string | undefined
    const signature = request.headers['x-sendletter-signature'] as string | undefined

    if (!secret) {
      throw new NodeOperationError(
        this.getNode(),
        'This trigger has no signing secret. Deactivate and reactivate the workflow to subscribe again.',
      )
    }

    // rawBody, not the parsed object: the signature covers the exact bytes that
    // arrived, and re-serialising JSON does not reproduce them.
    const raw = (request as unknown as { rawBody?: Buffer }).rawBody
    const body = raw ? raw.toString('utf8') : JSON.stringify(request.body)

    if (!signatureMatches(secret, body, signature, { createHmac, timingSafeEqual })) {
      // 401 and no items. An unsigned request is somebody else's, and starting
      // the workflow on it is the whole risk this node removes.
      return { noWebhookResponse: false, webhookResponse: { status: 401 }, workflowData: undefined }
    }

    const event = request.body as IDataObject
    return {
      workflowData: [[{ json: event }]],
    }
  }
}
