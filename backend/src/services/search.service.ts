import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';

export const elasticClient = new Client({
  node: env.ELASTICSEARCH_URL,
});

export const ELASTIC_EMAIL_INDEX = 'emails';

export class SearchService {
  static async initializeIndex() {
    try {
      const exists = await elasticClient.indices.exists({ index: ELASTIC_EMAIL_INDEX });
      if (!exists) {
        await elasticClient.indices.create({
          index: ELASTIC_EMAIL_INDEX,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                user_id: { type: 'keyword' },
                recipient: { type: 'text' },
                subject: { type: 'text' },
                status: { type: 'keyword' },
                sent_at: { type: 'date' },
              }
            }
          }
        });
        console.log(`Created Elasticsearch index: ${ELASTIC_EMAIL_INDEX}`);
      }
    } catch (error) {
      console.error('Failed to initialize Elasticsearch index:', error);
    }
  }

  static async indexEmail(emailData: any) {
    try {
      await elasticClient.index({
        index: ELASTIC_EMAIL_INDEX,
        id: emailData.id,
        document: {
          id: emailData.id,
          user_id: emailData.user_id,
          recipient: emailData.recipient,
          subject: emailData.subject,
          status: emailData.status,
          sent_at: emailData.sent_at,
        },
      });
    } catch (error) {
      console.error(`Failed to index email ${emailData.id} in Elasticsearch:`, error);
    }
  }

  static async searchEmails(userId: string, query: string) {
    try {
      const result = await elasticClient.search({
        index: ELASTIC_EMAIL_INDEX,
        body: {
          query: {
            bool: {
              must: [
                { term: { user_id: userId } },
                {
                  multi_match: {
                    query,
                    fields: ['recipient', 'subject', 'status'],
                    fuzziness: 'AUTO'
                  }
                }
              ]
            }
          },
          sort: [{ sent_at: { order: 'desc' } }]
        }
      });

      return result.hits.hits.map((hit: any) => hit._source);
    } catch (error) {
      console.error('Elasticsearch search error:', error);
      return [];
    }
  }
}
