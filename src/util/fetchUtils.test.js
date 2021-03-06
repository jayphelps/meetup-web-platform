import {
	mockQuery,
} from 'meetup-web-mocks/lib/app';
import {
	MOCK_GROUP,
} from 'meetup-web-mocks/lib/api';
import * as fetchUtils from './fetchUtils';

describe('fetchQueries', () => {
	const API_URL = new URL('http://api.example.com/');
	const queries = [mockQuery({})];
	const responses = [MOCK_GROUP];
	const csrfJwt = 'encodedstuff';
	const fakeSuccess = () =>
		Promise.resolve({
			json: () => Promise.resolve(responses),
			headers: {
				get: key => ({
					'x-csrf-jwt': csrfJwt,
				}[key]),
			},
		});

	it('returns an object with queries and responses arrays', () => {
		spyOn(global, 'fetch').and.callFake(fakeSuccess);

		return fetchUtils.fetchQueries(API_URL.toString(), { method: 'GET' })(queries)
			.then(response => {
				expect(response.queries).toEqual(jasmine.any(Array));
				expect(response.responses).toEqual(jasmine.any(Array));
			});
	});
	it('returns an object with csrf prop read from response headers', () => {
		spyOn(global, 'fetch').and.callFake(fakeSuccess);

		return fetchUtils.fetchQueries(API_URL.toString(), { method: 'GET' })(queries)
			.then(response => expect(response.csrf).toEqual(csrfJwt));
	});
	describe('GET', () => {
		it('calls fetch with API url with GET and querystring', () => {
			spyOn(global, 'fetch').and.callFake(fakeSuccess);

			return fetchUtils.fetchQueries(API_URL.toString(), { method: 'GET' })(queries)
				.then(() => {
					const calledWith = global.fetch.calls.mostRecent().args;
					const url = new URL(calledWith[0]);
					expect(url.origin).toBe(API_URL.origin);
					expect(new URLSearchParams(url.search).has('queries')).toBe(true);
					expect(calledWith[1].method).toEqual('GET');
				});
		});
	});
	describe('POST', () => {
		it('calls fetch API url with POST method, csrf header, and body params', () => {
			spyOn(global, 'fetch').and.callFake(fakeSuccess);

			return fetchUtils.fetchQueries(API_URL.toString(), { method: 'POST', csrf: csrfJwt })(queries)
				.then(() => {
					const calledWith = global.fetch.calls.mostRecent().args;
					const url = new URL(calledWith[0]);
					const options = calledWith[1];
					expect(url.toString()).toBe(API_URL.toString());
					expect(options.method).toEqual('POST');
					expect(options.body.has('queries')).toBe(true);
					expect(options.headers['x-csrf-jwt']).toEqual(csrfJwt);
				});
		});
	});
});

describe('makeCookieHeader', () => {
	it('makes a cookie header string from a { key<string> : value<string> } object', () => {
		expect(fetchUtils.makeCookieHeader({ foo: 'foo', bar: 'bar' }))
			.toEqual('foo=foo; bar=bar');
	});
});

