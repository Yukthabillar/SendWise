import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Email {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt?: string;
  sentAt?: string;
  status: string;
}

interface EmailTableProps {
  type: 'scheduled' | 'sent';
}

const EmailTable: React.FC<EmailTableProps> = ({ type }) => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchEmails();
  }, [type]);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/emails/${type}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setEmails(response.data.emails || []);
    } catch (error) {
      console.error(`Failed to fetch ${type} emails`, error);
    }
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) {
      fetchEmails();
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/emails/search?q=${searchQuery}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Filter the search results locally to match the active tab if necessary, 
      // or just show all search results
      setEmails(response.data.emails || []);
    } catch (error) {
      console.error('Search failed', error);
    }
    setLoading(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search emails..."
            className="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm border border-gray-300 hover:bg-gray-50"
          >
            Search
          </button>
        </form>
      </div>

      {emails.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">No {type} emails yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Recipient</th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Subject</th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  {type === 'scheduled' ? 'Scheduled Time' : 'Sent Time'}
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {emails.map((email) => (
                <tr key={email.id}>
                  <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                    {email.recipient}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {email.subject}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    {type === 'scheduled' 
                      ? new Date(email.scheduledAt!).toLocaleString() 
                      : (email.sentAt ? new Date(email.sentAt).toLocaleString() : '-')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                    <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                      email.status === 'sent' ? 'bg-green-100 text-green-800' : 
                      email.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                      email.status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {email.status.charAt(0).toUpperCase() + email.status.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default EmailTable;
