import Boom from 'boom';
import chalk from 'chalk';
import Rx from 'rxjs';

/**
 * @module requestAuthPlugin
 */

function tryJSON(response) {
	const { status } = response;
	if (status >= 400) {  // status always 200: bugzilla #52128
		throw new Error(`API responded with error code ${status}`);
	}
	return response.text().then(text => JSON.parse(text));
}

function verifyAuth([request, auth]) {
	const keys = Object.keys(auth);
	if (!keys.length) {
		const errorMessage = 'No auth info provided';
		console.error(
			chalk.red(errorMessage),
			': application can not fetch data.',
			'You might be able to recover by clearing cookies and refreshing'
		);
		throw new Error(errorMessage);
	}
	// there are secret tokens in `auth`, be careful with logging
	request.log(['auth'], `Authorizing with keys: ${JSON.stringify(keys)}`);
}

function injectAuthIntoRequest([request, auth]) {
	// update request with auth info
	request.state.oauth_token = auth.access_token;  // this endpoint provides 'access_token' instead of 'oauth_token'
	request.state.refresh_token = auth.refresh_token;  // use to get new oauth upon expiration
	request.state.expires_in = auth.expires_in;  // TTL for oauth token (in seconds)

	// special prop in `request.app` to indicate that this is a new,
	// server-provided token, not from the original request, so the cookies
	// will need to be set in the response
	request.app.setCookies = true;
}

/**
 * Ensure that the passed-in Request contains a valid Oauth token
 *
 * If the Request already has a valid oauth token, it is returned unchanged,
 * otherwise the request is parsed for more info and a new token is set
 *
 * @param {Observable} auth$ a function that takes a request and emits new auth
 *   data
 * @param {Request} request Hapi request to modify with auth token (if necessary)
 * @return {Observable} Observable that emits the request with auth applied
 */
export const requestAuthorizer = auth$ => request => {
	// always need oauth_token, even if it's an anonymous (pre-reg) token
	// This is 'deferred' because we don't want to start fetching the token
	// before we know that it's needed
	const deferredAuth$ = Rx.Observable.defer(() => auth$(request));

	const request$ = Rx.Observable.of(request);
	return Rx.Observable.if(
		() => request.state.oauth_token,
		request$,
		request$
			.zip(deferredAuth$)
			.do(verifyAuth)
			.do(injectAuthIntoRequest)
			.map(([request, auth]) => request)  // throw away auth info
	);
};

/**
 * Get an anonymous code from the API that can be used to generate an oauth
 * access token
 *
 * @param {Object} config { OAUTH_AUTH_URL, oauth }
 * @param {String} redirect_uri Return url after anonymous grant
 */
export function getAnonymousCode$({ API_TIMEOUT=5000, OAUTH_AUTH_URL, oauth }, redirect_uri) {
	if (!oauth.key) {
		throw new ReferenceError('OAuth consumer key is required');
	}

	const authParams = new URLSearchParams();
	authParams.append('response_type', 'anonymous_code');
	authParams.append('client_id', oauth.key);
	authParams.append('redirect_uri', redirect_uri);
	const authURL = `${OAUTH_AUTH_URL}?${authParams}`;
	const requestOpts = {
		method: 'GET',
		headers: {
			Accept: 'application/json'
		},
	};

	return Rx.Observable.defer(() => {
		console.log(`Fetching anonymous auth code from ${OAUTH_AUTH_URL}`);
		return Rx.Observable.fromPromise(fetch(authURL, requestOpts))
			.timeout(API_TIMEOUT)
			.flatMap(tryJSON)
			.catch(error => {
				console.log(error.stack);
				return Rx.Observable.of({ code: null });
			})
			.map(({ code }) => ({
				grant_type: 'anonymous_code',
				token: code
			}));
	});
}

/**
 * Curry the config to generate a function that receives a grant type and grant
 * token that can be used to generate an oauth access token from the API
 * @param {Object} config object containing the oauth secret and key
 * @param {String} redirect_uri Return url after anonymous grant
 * @param {Object} headers Hapi request headers for anonymous user request
 * @return {Object} the JSON-parsed response from the authorize endpoint
 *   - contains 'access_token', 'refresh_token'
 */
export const getAccessToken$ = ({ API_TIMEOUT=5000, OAUTH_ACCESS_URL, oauth }, redirect_uri) => {
	if (!oauth.key) {
		throw new ReferenceError('OAuth consumer key is required');
	}
	if (!oauth.secret) {
		throw new ReferenceError('OAuth consumer secret is required');
	}
	const params = {
		client_id: oauth.key,
		client_secret: oauth.secret,
		redirect_uri
	};
	return headers => {
		const requestOpts = {
			method: 'POST',
			headers: {
				Cookie: headers['cookie'],
				Accept: headers['accept'],
				'Accept-Language': headers['accept-language'],
				'Cache-Control': headers['cache-control']
			},
		};
		const accessParams = Object.keys(params)
			.reduce((accessParams, key) => {
				accessParams.append(key, params[key]);
				return accessParams;
			}, new URLSearchParams());

		return ({ grant_type, token }) => {

			if (!token) {
				throw new ReferenceError('No grant token provided - cannot obtain access token');
			}

			accessParams.append('grant_type', grant_type);
			if (grant_type === 'anonymous_code') {
				console.log(`Fetching anonymous access_token from ${OAUTH_ACCESS_URL}`);
				accessParams.append('code', token);
			}
			if (grant_type === 'refresh_token') {
				console.log(`Refreshing access_token from ${OAUTH_ACCESS_URL}`);
				accessParams.append('refresh_token', token);
			}

			const url = `${OAUTH_ACCESS_URL}?${accessParams}`;

			return Rx.Observable.fromPromise(fetch(url, requestOpts))
				.timeout(API_TIMEOUT)
				.flatMap(tryJSON);
		};
	};
};

/**
 * Curry a function that will get a new auth token for a passed-in request.
 * For an anonymous auth, the request header information is used to determine
 * the location and language of the anonymous member
 *
 * @param {Object} config { OAUTH_AUTH_URL, OAUTH_ACCESS_URL, oauth }
 * @param {Object} request the Hapi request that needs to be authorized
 */
export const requestAuth$ = config => {
	const redirect_uri = 'http://www.meetup.com/';  // required param set in oauth consumer config
	const code$ = getAnonymousCode$(config, redirect_uri);
	const token$ = getAccessToken$(config, redirect_uri);

	// if the request has a refresh_token, use it. Otherwise, get a new anonymous access token
	return request => Rx.Observable.if(
		() => request.state.refresh_token,
		Rx.Observable.of({
			grant_type: 'refresh_token',
			token: request.state.refresh_token
		}),
		code$
	)
	.flatMap(token$(request.headers))
	.catch(error => {
		console.log(error.stack);
		return Rx.Observable.of({});  // failure results in empty object response - bad time
	});
};

/**
 * This plugin does two things.
 *
 * 1. Adds an 'authorize' interface on the Hapi `request`, which ensures that
 * the request has an oauth_token cookie - it provides an anonymous token when
 * none is provided in the request, and refreshes a token that has expired
 * 2. Adds a new route that returns the auth JSON containing the new oauth_token
 * (configurable, defaults to '/auth')
 *
 * {@link http://hapijs.com/tutorials/plugins}
 */
export default function register(server, options, next) {
	// create a single requestAuth$ stream that can be used by any route
	const auth$ = requestAuth$(options);
	// create a single stream for modifying an arbitrary request with anonymous auth
	const authorizeRequest$ = requestAuthorizer(auth$);

	server.decorate(
		'request',
		'authorize',
		request => () => authorizeRequest$(request),
		{ apply: true }
	);

	server.route({
		method: 'GET',
		path: options.AUTH_ENDPOINT,
		handler: (request, reply) => {
			auth$(request).subscribe(
				auth => {
					const response = reply(JSON.stringify(auth))
						.type('application/json');
					reply.track(response, 'logout');
				},
				(err) => { reply(Boom.badImplementation(err.message)); }
			);
		}
	});

	next();
}
register.attributes = {
	name: 'requestAuth',
	version: '1.0.0',
};
