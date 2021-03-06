import Rx from 'rxjs';
import register, {
	getAuthenticate,
	oauthScheme,
	requestAuth$,
	getAnonymousCode$,
	getAccessToken$,
	requestAuthorizer,
} from './requestAuthPlugin';

const oauth = {
	key: '1234',
	secret: 'asdf',
};
const MOCK_SERVER = {
	decorate() {},
	route() {},
	auth: {
		scheme: () => {},
	},
	ext: () => {},
};
const MOCK_HEADERS = {};
const MOCK_REPLY_FN = () => {};
MOCK_REPLY_FN.state = () => {};
MOCK_REPLY_FN.continue = () => {};
const MOCK_REQUEST = {
	headers: MOCK_HEADERS,
	state: {},
	app: {},
	log: (tags, data) => { console.log(data); },
	authorize: () => Rx.Observable.of(MOCK_REQUEST),
	query: {},
	plugins: {},
};
const MOCK_AUTHED_REQUEST = {
	headers: MOCK_HEADERS,
	state: { oauth_token: 'good_token' },
	app: {},
	log: (tags, data) => { console.log(data); },
	authorize: () => Rx.Observable.of(MOCK_AUTHED_REQUEST),
	query: {},
};
MOCK_REQUEST.plugins.requestAuth = {
	reply: MOCK_REPLY_FN
};

const GOOD_MOCK_FETCH_RESULT = Promise.resolve({
	text: () => Promise.resolve('{}')
});
const BAD_MOCK_FETCH_RESULT = Promise.resolve({ text: () => Promise.resolve(undefined) });

const OAUTH_AUTH_URL = 'auth_fakeout';
const OAUTH_ACCESS_URL = 'access_fakeout';
const MOCK_CODE = { grant_type: 'anonymous_code', token: 'mock_anon_code' };

describe('getAnonymousCode$', () => {
	it('sets OAUTH_AUTH_URL as opts.url', function(done) {
		// given the config, the mocked request function should return the auth url in code.url
		spyOn(global, 'fetch').and.callFake((url, opts) => {
			expect(url.startsWith(OAUTH_AUTH_URL)).toBe(true);
			return GOOD_MOCK_FETCH_RESULT;
		});
		getAnonymousCode$({ oauth, OAUTH_AUTH_URL }).subscribe(done);
	});
	it('throws error when response cannot be JSON parsed', function() {
		spyOn(global, 'fetch').and.callFake((url, opts) => BAD_MOCK_FETCH_RESULT);

		return getAnonymousCode$({ oauth, OAUTH_AUTH_URL })
			.toPromise()
			.catch(err => {
				expect(err).toEqual(jasmine.any(Error));
			});
	});

});

describe('getAccessToken$', () => {
	it('sets OAUTH_ACCESS_URL as opts.url', function(done) {
		spyOn(global, 'fetch').and.callFake((url, opts) => {
			expect(url.startsWith(OAUTH_ACCESS_URL)).toBe(true);
			return GOOD_MOCK_FETCH_RESULT;
		});
		const getToken$ = getAccessToken$({ oauth, OAUTH_ACCESS_URL }, null);
		getToken$(MOCK_HEADERS)(MOCK_CODE).subscribe(done);
	});
	it('throws an error when no oauth.key is supplied', function() {
		const oauthNoKey = { ...oauth };
		delete oauthNoKey.key;
		expect(() => getAccessToken$({ oauth: oauthNoKey, OAUTH_ACCESS_URL }, null))
			.toThrowError(ReferenceError);
	});
	it('throws an error when no oauth.secret is supplied', function() {
		const oauthNoSecret = { ...oauth };
		delete oauthNoSecret.secret;
		expect(() => getAccessToken$({ oauth: oauthNoSecret, OAUTH_ACCESS_URL }, null))
			.toThrowError(ReferenceError);
	});
	it('throws an error when no access code is supplied to the final curried function', function() {
		const token = null;
		const getToken$ = getAccessToken$({ oauth, OAUTH_ACCESS_URL }, null);
		expect(() => getToken$(MOCK_HEADERS)({ ...MOCK_CODE, token })).toThrowError(ReferenceError);
	});
	it('throws an error when response cannot be JSON parsed', function(done) {
		spyOn(global, 'fetch').and.callFake((url, opts) => BAD_MOCK_FETCH_RESULT);
		const getToken$ = getAccessToken$({ oauth, OAUTH_ACCESS_URL }, null);
		getToken$(MOCK_HEADERS)(MOCK_CODE)
			.catch(err => {
				expect(err).toEqual(jasmine.any(Error));
				return Rx.Observable.of(null);
			})
			.subscribe(done);
	});
});

describe('requestAuth$', () => {
	it('returns token when provided URLs and oauth info', function(done) {
		spyOn(global, 'fetch').and.callFake((url, opts) => {
			if (url.startsWith(OAUTH_AUTH_URL)) {
				return Promise.resolve({
					text: () => Promise.resolve('{ "code": 1234 }')
				});
			}
			if (url.startsWith(OAUTH_ACCESS_URL)) {
				return Promise.resolve({
					text: () => Promise.resolve('{ "oauth_token": "good_token" }')
				});
			}
		});
		const auth$ = requestAuth$({ oauth, OAUTH_AUTH_URL, OAUTH_ACCESS_URL }, null);

		auth$({ ...MOCK_REQUEST }).subscribe(auth => {
			expect(auth.oauth_token).toBe('good_token');
			done();
		});
	});
});
describe('requestAuthorizer', () => {
	const auth$ = requestAuth$({ oauth, OAUTH_AUTH_URL, OAUTH_ACCESS_URL }, null);
	const authorizeRequest$ = requestAuthorizer(auth$);
	it('does not try to fetch when provided a request with an oauth token in state', () => {
		spyOn(global, 'fetch').and.callFake((url, opts) => {
			if (url.startsWith(OAUTH_AUTH_URL)) {
				return Promise.resolve({
					text: () => Promise.resolve('{ "code": 1234 }')
				});
			}
			if (url.startsWith(OAUTH_ACCESS_URL)) {
				return Promise.resolve({
					text: () => Promise.resolve('{ "oauth_token": "good_token" }')
				});
			}
		});

		return authorizeRequest$({ ...MOCK_AUTHED_REQUEST })
			.toPromise()
			.then(request => {
				expect(global.fetch).not.toHaveBeenCalled();
			});
	});
	it('calls fetch when provided a request without an oauth token in state', () => {
		spyOn(global, 'fetch').and.callFake((url, opts) => {
			if (url.startsWith(OAUTH_AUTH_URL)) {
				return Promise.resolve({
					text: () => Promise.resolve('{ "code": 1234 }')
				});
			}
			if (url.startsWith(OAUTH_ACCESS_URL)) {
				return Promise.resolve({
					text: () => Promise.resolve('{ "oauth_token": "good_token" }')
				});
			}
		});
		return authorizeRequest$({ ...MOCK_REQUEST })
			.toPromise()
			.then(request => {
				expect(global.fetch).toHaveBeenCalled();
			});
	});
});
describe('register', () => {
	const spyable = {
		next() {}
	};
	const options = {
		OAUTH_AUTH_URL: '',
		OAUTH_ACCESS_URL: '',
		oauth: {
			key: '1234',
			secret: 'abcd',
		},
	};
	it('calls next', () => {
		spyOn(spyable, 'next');
		register(MOCK_SERVER, options, spyable.next);
		expect(spyable.next).toHaveBeenCalled();
	});
});

describe('oauthScheme', () => {
	const options = {
		OAUTH_AUTH_URL: '',
		OAUTH_ACCESS_URL: '',
		oauth: {
			key: '1234',
			secret: 'abcd',
		},
	};
	it('calls server.ext with an \'onPreAuth\' function', () => {
		spyOn(MOCK_SERVER, 'ext');
		oauthScheme(MOCK_SERVER, options);
		expect(MOCK_SERVER.ext).toHaveBeenCalledWith('onPreAuth', jasmine.any(Function));
	});
});

describe('getAuthenticate', () => {
	it('calls request.authorize', () => {
		const spyable = {
			authenticateRequest$: x => Rx.Observable.of(x),
		};
		spyOn(spyable, 'authenticateRequest$').and.callThrough();
		return new Promise((resolve, reject) =>
			getAuthenticate(spyable.authenticateRequest$)(MOCK_REQUEST, MOCK_REPLY_FN).add(() => {
				expect(spyable.authenticateRequest$).toHaveBeenCalled();
				resolve();
			})
		);
	});
	it('calls reply.continue with credentials and artifacts', () => {
		spyOn(MOCK_REPLY_FN, 'continue');
		return new Promise((resolve, reject) =>
			getAuthenticate(x => Rx.Observable.of(x))({ ...MOCK_AUTHED_REQUEST }, MOCK_REPLY_FN).add(() => {
				expect(MOCK_REPLY_FN.continue)
					.toHaveBeenCalledWith({ credentials: jasmine.any(String), artifacts: jasmine.any(String) });
				resolve();
			})
		);
	});
});
