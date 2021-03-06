import {
	MOCK_API_RESULT,
	MOCK_renderRequestMap,
	MOCK_API_PROXY$,
	MOCK_RENDER_RESULT,
	MOCK_VALID_CONFIG,
} from 'meetup-web-mocks/lib/app';

import getRoutes from './routes';
import { getServer } from './util/testUtils';

function getResponse(injectRequest, server=getServer()) {
	// a Promise that returns the server instance after it has been
	// configured with the routes being tested
	const routes = getRoutes(
		MOCK_renderRequestMap,
		MOCK_VALID_CONFIG,
		MOCK_API_PROXY$
	);
	server.route(routes);
	return server.inject(injectRequest);
}

describe('routes', () => {
	it('serves the homepage route', () =>
		getResponse({ url: '/' })
			.then(response => expect(response.payload).toEqual(MOCK_RENDER_RESULT))
	);
	it('serves the api route', () =>
		getResponse({ url: '/api' })
			.then(response => expect(JSON.parse(response.payload)).toEqual(MOCK_API_RESULT))
	);
});

