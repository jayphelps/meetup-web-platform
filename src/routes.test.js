import getRoutes from './routes';
import {
	MOCK_API_RESULT,
	MOCK_OAUTH_COOKIES,
	MOCK_renderRequestMap,
	MOCK_API_PROXY$,
	MOCK_RENDER_RESULT,
	MOCK_REQUEST_COOKIES,
	MOCK_VALID_CONFIG,
} from './util/mocks/app';
import {
	parseCookieHeader,
	getServer,
} from './util/testUtils';

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
	it('sets oauth cookies in response when request.app.setCookies is true', () =>
		getResponse({ ...MOCK_REQUEST_COOKIES, app: { setCookies: true }})
			.then(response => {
				const cookieHeader = response.headers['set-cookie'];
				expect(cookieHeader).not.toBeNull();

				const cookies = parseCookieHeader(cookieHeader);
				expect(cookies.oauth_token).toBe(MOCK_OAUTH_COOKIES.oauth_token);
				expect(cookies.refresh_token).toBe(MOCK_OAUTH_COOKIES.refresh_token);
				expect(cookies.anonymous).toBe(MOCK_OAUTH_COOKIES.anonymous.toString());
			})
	);
});

