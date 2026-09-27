import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import ComposeEmailModal from '../components/ComposeEmailModal';
import EmailTable from '../components/EmailTable';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');

  const handleSlackConnect = () => {
    window.location.href = 'http://localhost:5000/api/slack/connect';
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex items-center">
              <span className="text-xl font-bold text-indigo-600">SendWise</span>
            </div>
            <div className="flex items-center space-x-4">
              <button 
                onClick={handleSlackConnect}
                className="text-sm font-medium text-gray-500 hover:text-gray-900"
              >
                Connect Slack
              </button>
              <div className="flex items-center space-x-2">
                <img className="h-8 w-8 rounded-full" src={user?.avatar_url || 'https://via.placeholder.com/32'} alt="" />
                <span className="text-sm font-medium text-gray-700">{user?.name}</span>
              </div>
              <button onClick={logout} className="text-sm text-red-600 hover:text-red-800">
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-gray-900">Campaigns</h1>
            <button
              onClick={() => setIsComposeOpen(true)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Compose New Email
            </button>
          </div>

          <div className="mb-4 border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('scheduled')}
                className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
                  activeTab === 'scheduled'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                Scheduled Emails
              </button>
              <button
                onClick={() => setActiveTab('sent')}
                className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${
                  activeTab === 'sent'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                Sent Emails
              </button>
            </nav>
          </div>

          <EmailTable type={activeTab} />
        </div>
      </main>

      {isComposeOpen && (
        <ComposeEmailModal onClose={() => setIsComposeOpen(false)} />
      )}
    </div>
  );
};

export default Dashboard;
