import Rx from 'rxjs';
import Boom from 'boom';
import chalk from 'chalk';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import RouterContext from 'react-router/lib/RouterContext';
import match from 'react-router/lib/match';
import RedBox from 'redbox-react';
import { Provider } from 'react-redux';

import createStore from '../util/createStore';
import Dom from '../components/dom';
import { polyfillNodeIntl } from '../util/localizationUtils';
import { catchAndReturn$ } from '../util/rxUtils';

import {
	configureAuth
} from '../actions/authActionCreators';

import {
	configureApiUrl,
	configureTrackingId
} from '../actions/configActionCreators';

// Ensure global Intl for use with FormatJS
polyfillNodeIntl();

const DOCTYPE = '<!DOCTYPE html>';

/**
 * An async module that renders the full app markup for a particular URL/location
 * using [ReactDOMServer]{@link https://facebook.github.io/react/docs/top-level-api.html#reactdomserver}
 *
 * @module ServerRender
 */

function getHtml(assetPublicPath, clientFilename, initialState={}, appMarkup='') {
	const htmlMarkup = ReactDOMServer.renderToString(
		<Dom
			assetPublicPath={assetPublicPath}
			clientFilename={clientFilename}
			initialState={initialState}
			appMarkup={appMarkup}
		/>
	);
	return `${DOCTYPE}${htmlMarkup}`;
}

/**
 * Using the current route information and Redux store, render the app to an
 * HTML string and server response code.
 *
 * There are three parts to the render:
 *
 * 1. `appMarkup`, which corresponds to the markup that will be rendered
 * on the client by React. This string is built before the full markup because
 * it sets the data needed by other parts of the DOM, such as `<head>`.
 * 2. `htmlMarkup`, which wraps `appMarkup` with the remaining DOM markup.
 * 3. `doctype`, which is just the doctype element that is a sibling of `<html>`
 *
 * @param {Object} renderProps
 * @param {ReduxStore} store the store containing the initial state of the app
 * @return {Object} the statusCode and result used by Hapi's `reply` API
 *   {@link http://hapijs.com/api#replyerr-result}
 */
const getRouterRenderer = (store, clientFilename, assetPublicPath) =>
	([ redirectLocation, renderProps ]) => {
		// pre-render the app-specific markup, this is the string of markup that will
		// be managed by React on the client.
		//
		// **IMPORTANT**: this string is built separately from `<Dom />` because it
		// initializes page-specific state that `<Dom />` needs to render, e.g.
		// `<head>` contents
		const initialState = store.getState();
		const appMarkup = ReactDOMServer.renderToString(
			<Provider store={store}>
				<RouterContext {...renderProps} />
			</Provider>
		);
		const statusCode = renderProps.routes.pop().statusCode || 200;

		// all the data for the full `<html>` element has been initialized by the app
		// so go ahead and assemble the full response body
		const result = getHtml(
			assetPublicPath,
			clientFilename,
			initialState,
			appMarkup
		);

		return {
			statusCode,
			result
		};
	};

/**
 * Curry a Redux store and auth tokens to privde a function that can dispatch
 * the actions necessary to set up the initial state of the app when supplied
 * matching route information
 *
 * @param {Store} store Redux store for this request
 * @param {Object} config auth tokens, e.g. oauth_token
 * @return dispatchMatch functiont that takes the 'match' callback args and
 *   dispatches necessary initialization actions (auth and RENDER)
 */
const dispatchConfig = (store, { apiUrl, auth, meetupTrack }) => {
	console.log(chalk.green('Dispatching config'));

	store.dispatch(configureAuth(auth, true));
	store.dispatch(configureApiUrl(apiUrl));
	store.dispatch(configureTrackingId(meetupTrack));
};

/**
 * Curry a function that takes a Hapi request and returns an observable
 * that will emit the rendered HTML
 *
 * The outer function takes app-specific information about the routes,
 * reducer, and optional additional middleware
 *
 * @param {Object} routes the React Router routes object
 * @param {Function} reducer the root Redux reducer for the app
 * @param {Function} middleware (optional) any app-specific middleware that
 *   should be applied to the store
 *
 * @return {Function}
 *
 * -- Returned Fn --
 * @param {Request} request The request to render - must already have an
 * `oauth_token` in `state`
 * @return {Observable}
 */
const makeRenderer = (
	routes,
	reducer,
	clientFilename,
	assetPublicPath,
	middleware=[]
) => request => {

	middleware = middleware || [];
	request.log(['info'], chalk.green(`Rendering ${request.url.href}`));
	const {
		url,
		info,
		server,
		state: {
			oauth_token,
			refresh_token,
			expires_in,
			anonymous,
			meetupTrack
		}
	} = request;

	const location = url.path;
	const apiUrl = `${server.info.protocol}://${info.host}/api`;
	const auth = {
		oauth_token,
		refresh_token,
		expires_in,
		anonymous,
	};

	// create the store
	const store = createStore(routes, reducer, {}, middleware);

	// load initial config
	dispatchConfig(store, { apiUrl, auth, meetupTrack });

	// render skeleton if requested - the store is ready
	if ('skeleton' in request.query) {
		return Rx.Observable.of({
			result: getHtml(assetPublicPath, clientFilename, store.getState()),
			statusCode: 200
		});
	}

	// otherwise render using the API and React router
	const storeIsReady$ = Rx.Observable.create(obs => {
		obs.next(store.getState());
		return store.subscribe(() => obs.next(store.getState()));
	})
	.first(state => state.preRenderChecklist.every(isReady => isReady));  // take the first ready state

	return Rx.Observable.bindNodeCallback(match)({ location, routes })
		.do(([redirectLocation, renderProps]) => {
			if (!redirectLocation && !renderProps) {
				throw Boom.notFound();
			}
		})
		.do(([redirectLocation, renderProps]) =>
			store.dispatch({
				type: '@@server/RENDER',
				payload: renderProps.location
			})
		)
		.flatMap(args => storeIsReady$.map(() => args))  // `sample` appears not to work - this is equivalent
		.map(getRouterRenderer(store, clientFilename, assetPublicPath))
		.catch(error => {
			// render errors result in a rendered stack trace using RedBox
			const appMarkup = ReactDOMServer.renderToString(<RedBox error={error} />);
			const result = `${DOCTYPE}<html><body>${appMarkup}</body></html>`;
			const statusCode = 500;

			// also log to the console with `catchAndReturn`
			return catchAndReturn$({
				result,
				statusCode
			}, request.log)(error);
		});
};

export default makeRenderer;

