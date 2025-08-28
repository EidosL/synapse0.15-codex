import { JobView } from './insights'; // The JobView type is already defined here

const API_BASE_URL = 'http://localhost:8000'; // This should be in a config file

// A helper to handle fetch responses
const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.statusText} - ${errorText}`);
    }
    return response.json();
};

export const getJobStatus = async (jobId: string): Promise<JobView> => {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`);
    return handleResponse(response);
};
