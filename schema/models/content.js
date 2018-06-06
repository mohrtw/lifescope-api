/* @flow */

import config from 'config';
import _ from 'lodash';
import composeWithMongoose from 'graphql-compose-mongoose/node8';
import mongoose from 'mongoose';

import uuid from "../../lib/util/uuid";
import {add as addTags, remove as removeTags} from './templates/tag';
import {TagTC} from "./tags";

export const ContentSchema = new mongoose.Schema(
	{
		_id: {
			type: Buffer
		},

		id: {
			type: String,
			get: function () {
				if (this._id) {
					return this._id.toString('hex');
				}
			},
			set: function (val) {
				if (this._conditions && this._conditions.id) {
					if (this._conditions.id.hasOwnProperty('$in')) {
						this._conditions._id = {
							$in: _.map(this._conditions.id.$in, function(item) {
								return uuid(item);
							})
						};
					}
					else {
						this._conditions._id = uuid(val);
					}

					delete this._conditions.id;
				}

				if (val.hasOwnProperty('$in')) {
					this._id = {
						$in: _.map(val.$in, function(item) {
							return uuid(item);
						})
					};

				}
				else {
					this._id = uuid(val);
				}
			}
		},

		connection: {
			type: Buffer,
			index: false
		},

		connection_id_string: {
			type: String,
			get: function () {
				if (this.connection) {
					return this.connection.toString('hex');
				}
			},
			set: function (val) {
				if (this._conditions && this._conditions.connection_id_string) {
					this._conditions.connection = uuid(val);

					delete this._conditions.connection_id_string;
				}

				this.connection = uuid(val);
			}
		},

		created: {
			type: Date,
			index: false
		},

		embed_content: {
			type: String,
			index: false
		},

		embed_format: {
			type: String,
			index: false
		},

		embed_thumbnail: {
			type: String,
			index: false
		},

		identifier: {
			type: String,
			index: false
		},

		mimetype: {
			type: String,
			index: false
		},

		owner: {
			type: String,
			index: false
		},

		provider_name: {
			type: String,
			index: false
		},

		remote_id: {
			type: String,
			index: false
		},

		tagMasks: {
			added: {
				type: [String]
			},
			removed: {
				type: [String]
			},
			source: {
				type: [String]
			}
		},

		text: {
			type: String,
			index: false
		},

		thumbnail: {
			type: String,
			index: false
		},

		title: {
			type: String,
			index: false
		},

		type: {
			type: String,
			index: false
		},

		updated: {
			type: Date,
			index: false
		},

		url: {
			type: String,
			index: false
		},

		user_id: {
			type: Buffer,
			index: false
		},

		user_id_string: {
			type: String,
			get: function () {
				return this.user_id.toString('hex')
			},
			set: function (val) {
				if (val && this._conditions && this._conditions.user_id_string) {
					this._conditions.user_id = uuid(val);

					delete this._conditions.user_id_string;
				}

				this.user_id = uuid(val);
			}
		},
	},
	{
		collection: 'content',
	}
);

export const Content = mongoose.model('Content', ContentSchema);

export const ContentTC = composeWithMongoose(Content);



ContentTC.addResolver({
	name: 'addContentTags',
	kind: 'mutation',
	type: TagTC.getResolver('findOne').getType(),
	args: {
		id: 'String',
		tags: ['String']
	},
	resolve: async function({source, args, context, info}) {
		return await addTags(context.req, args, ContentTC);
	}
});

ContentTC.addResolver({
	name: 'removeContentTags',
	kind: 'mutation',
	type: TagTC.getResolver('findOne').getType(),
	args: {
		id: 'String',
		tags: ['String']
	},
	resolve: async function({source, args, context, info}) {
		return await removeTags(context.req, args, ContentTC);
	}
});


ContentTC.addResolver({
	name: 'searchContent',
	kind: 'mutation',
	type: ContentTC.getResolver('findMany').getType(),
	args: {
		q: 'String',
		offset: 'Int',
		limit: 'Int',
		sortField: 'String',
		sortOrder: 'String',
		filters: 'String'
	},
	resolve: async function({source, args, context, info}) {
		let count, documents;
		let validate = env.validate;

		let filters = args.filters ? JSON.parse(args.filters) : {};
		let suppliedFilters = filters;

		let query = {
			filters: filters,
			limit: args.limit,
			offset: args.offset,
			q: args.q,
			sortField: args.sortField,
			sortOrder: args.sortOrder
		};

		let suppliedSortField = query.sortField;
		let suppliedSortOrder = query.sortOrder;

		try {
			await validate('#/requests/search', query);
		} catch(err) {
			throw new httpErrors(400, 'Query was invalid')
		}

		if (query.limit > config.objectMaxLimit) {
			query.limit = config.objectMaxLimit;
		}

		let sort;

		let validationVal = query;

		let specialSort = false;

		// for (let key in specialSorts) {
		// 	if (!specialSorts.hasOwnProperty(key)) {
		// 		break;
		// 	}
		//
		// 	let field = specialSorts[key];
		//
		// 	if ((key === 'emptyQueryRelevance' && query.sortField === '_score' && query.q == null) || query.sortField === field.condition) {
		// 		specialSort = true;
		// 		sort = field.values;
		//
		// 		_.each(sort, function(val, name) {
		// 			sort[name] = query.sortOrder === 'asc' ? 1 : -1;
		// 		});
		// 	}
		// }

		if (specialSort === false) {
			sort = {
				[query.sortField]: query.sortOrder === 'asc' ? 1 : -1
			}
		}

		if ((query.q != null && query.q.length > 0) || (query.filters != null && Object.keys(query.filters).length > 0)) {
			let contentAggregation = Content.aggregate();

			let contentPreLookupMatch = {
				user_id: context.req.user._id
			};

			let contentPostLookupMatch = {};

			let $connectionLookup = {
				from: 'connections',
				localField: 'connection',
				foreignField: '_id',
				as: 'hydratedConnection'
			};

			if (query.q != null && query.q.length > 0) {
				contentPreLookupMatch.$text = {
					$search: query.q
				};
			}

			if (_.has(query, 'filters.tagFilters') && query.filters.tagFilters.length > 0) {
				if (contentPreLookupMatch.$and == null) {
					contentPreLookupMatch.$and = [];
				}

				contentPreLookupMatch.$and.push({
					$or: [{
						$or: [{
							$and: [{
								'tagMasks.source': {
									$in: query.filters.tagFilters
								},

								'tagMasks.removed': {
									$nin: query.filters.tagFilters
								}
							}]
						}, {
							$and: [{
								'tagMasks.added': {
									$in: query.filters.tagFilters
								},

								'tagMasks.removed': {
									$nin: query.filters.tagFilters
								}
							}]
						}]
					}]
				});
			}

			if (_.has(query, 'filters.whatFilters') && query.filters.whatFilters.length > 0) {
				if (contentPreLookupMatch.$and == null) {
					contentPreLookupMatch.$and = [];
				}

				contentPreLookupMatch.$and.push({
					$or: query.filters.whatFilters
				});
			}

			if (_.has(query, 'filters.connectorFilters') && query.filters.connectorFilters.length > 0) {
				let lookupConnectorFilters = _.map(query.filters.connectorFilters, function(filter) {
					return filter.connection ? {
						'connection': filter.connection
					} : {
						'hydratedConnection.provider_name': {
							$regex: new RegExp(filter.provider_name, 'i')
						}
					};
				});

				if (contentPostLookupMatch.$and == null) {
					contentPostLookupMatch.$and = [];
				}

				contentPostLookupMatch.$and.push({
					$or: lookupConnectorFilters
				});
			}

			contentAggregation
				.match(contentPreLookupMatch)
				.lookup($connectionLookup)
				.unwind('$hydratedConnection')
				.match(contentPostLookupMatch)
				.project({
					_id: true
				});

			let aggregatedContent = await contentAggregation.exec();

			let contentIds = [];

			if (aggregatedContent.length > 0) {
				_.each(aggregatedContent, function (content) {
					contentIds.push(content._id);
				});
			}

			let filter = {
				user_id_string: context.req.user._id.toString('hex'),
				_id: {
					$in: contentIds
				}
			};

			if (query.sortField === 'title') {
				filter.title = {
					$nin: [null, ''],
				}
			}

			let contentMatches = await ContentTC.getResolver('findMany').resolve({
				args: {
					filter: filter,
					sort: sort,
					limit: query.limit,
					offset: query.offset
				},
				projection: {
					id: true,
					connection: true,
					connection_id_string: true,
					embed_content: true,
					embed_format: true,
					embed_thumbnail: true,
					mimetype: true,
					tagMasks: true,
					text: true,
					title: true,
					type: true,
					url: true
				}
			});

			let contentMatchCount = await ContentTC.getResolver('count').resolve({
				args: {
					filter: filter,
					sort: sort,
					limit: query.limit,
					offset: query.offset
				}
			});

			documents = contentMatches;
			count = contentMatchCount;

		}
		else {
			let filter = {
				user_id_string: context.req.user._id.toString('hex')
			};

			if (query.sortField === 'title') {
				filter.title = {
					$nin: [null, ''],
				}
			}

			let contentMatches = await ContentTC.getResolver('findMany').resolve({
				args: {
					filter: filter,
					sort: sort,
					limit: query.limit,
					skip: query.offset
				},
				projection: {
					id: true,
					connection: true,
					connection_id_string: true,
					embed_content: true,
					embed_format: true,
					embed_thumbnail: true,
					mimetype: true,
					tagMasks: true,
					text: true,
					title: true,
					type: true,
					url: true
				}
			});

			let contentMatchCount = await ContentTC.getResolver('count').resolve({
				args: {
					filter: {
						user_id_string: context.req.user._id.toString('hex')
					},
					sort: sort,
					limit: query.limit,
					offset: query.offset
				},
			});

			documents = contentMatches;
			count = contentMatchCount;
		}

		// let q = validationVal.q;
		// let sortField = validationVal.sortField;
		// let sortOrder = validationVal.sortOrder;
		// let limit = validationVal.limit;
		// let offset = validationVal.offset;
		// let prev = null;
		// let next = null;
		//
		// if (offset !== 0) {
		// 	prev = {
		// 		url: url.format({
		// 			protocol: 'https',
		// 			hostname: 'app.lifescope.io',
		// 			pathname: 'api/events'
		// 		}),
		// 		method: 'SEARCH',
		// 		body: {
		// 			limit: limit,
		// 			offset: Math.max(0, offset - limit),
		// 			q: q,
		// 			filters: suppliedFilters,
		// 			sortField: sortField,
		// 			sortOrder: sortOrder
		// 		}
		// 	};
		// }
		//
		// if (limit + offset < count) {
		// 	next = {
		// 		url: url.format({
		// 			protocol: 'https',
		// 			hostname: 'app.lifescope.io',
		// 			pathname: 'api/events'
		// 		}),
		// 		method: 'SEARCH',
		// 		body: {
		// 			limit: limit,
		// 			offset: offset + limit,
		// 			q: q,
		// 			filters: suppliedFilters,
		// 			sortField: suppliedSortField,
		// 			sortOrder: suppliedSortOrder
		// 		}
		// 	};
		// }

		return documents;
		// return {
		// 	count: count,
		// 	limit: limit,
		// 	offset: offset,
		// 	sortField: sortField,
		// 	sortOrder: sortOrder,
		// 	prev: prev,
		// 	next: next,
		// 	results: documents
		// };
	}
});