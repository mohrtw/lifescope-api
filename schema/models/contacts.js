/* @flow */

import config from 'config';
import _ from 'lodash';
import composeWithMongoose from 'graphql-compose-mongoose/node8';
import mongoose from 'mongoose';

import uuid from "../../lib/util/uuid";
import {add as addTags, remove as removeTags} from './templates/tag';
import {TagTC} from "./tags";
import {Content, ContentTC} from "./content";

export const ContactsSchema = new mongoose.Schema(
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

		avatar_url: {
			type: String,
			index: false
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

		handle: {
			type: String,
			index: false
		},

		identifier: {
			type: String,
			index: false
		},

		name: {
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

		updated: {
			type: Date,
			index: false
		},

		user_id: {
			type: Buffer,
			//index: false
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
		collection: 'contacts',
	}
);


export const Contacts = mongoose.model('Contacts', ContactsSchema);

export const ContactTC = composeWithMongoose(Contacts);



ContactTC.addResolver({
	name: 'addContactTags',
	kind: 'mutation',
	type: TagTC.getResolver('findOne').getType(),
	args: {
		id: 'String',
		tags: ['String']
	},
	resolve: async function({source, args, context, info}) {
		return await addTags(context.req, args, ContactTC);
	}
});

ContactTC.addResolver({
	name: 'removeContactTags',
	kind: 'mutation',
	type: TagTC.getResolver('findOne').getType(),
	args: {
		id: 'String',
		tags: ['String']
	},
	resolve: async function({source, args, context, info}) {
		return await removeTags(context.req, args, ContactTC);
	}
});


ContactTC.addResolver({
	name: 'searchContacts',
	kind: 'mutation',
	type: ContactTC.getResolver('findMany').getType(),
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
			let contactAggregation = Contact.aggregate();

			let contactPreLookupMatch = {
				user_id: context.req.user._id
			};

			let contactPostLookupMatch = {};

			let $connectionLookup = {
				from: 'connections',
				localField: 'connection',
				foreignField: '_id',
				as: 'hydratedConnection'
			};

			if (query.q != null && query.q.length > 0) {
				contactPreLookupMatch.$text = {
					$search: query.q
				};
			}

			if (_.has(query, 'filters.tagFilters') && query.filters.tagFilters.length > 0) {
				if (contactPreLookupMatch.$and == null) {
					contactPreLookupMatch.$and = [];
				}

				contactPreLookupMatch.$and.push({
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
				if (contactPreLookupMatch.$and == null) {
					contactPreLookupMatch.$and = [];
				}

				contactPreLookupMatch.$and.push({
					$or: query.filters.whatFilters
				});
			}

			if (_.has(query, 'filters.connectorFilters') && query.filters.connectorFilters.length > 0) {
				let lookupConnectorFilters = _.map(query.filters.connectorFilters, function(filter) {
					console.log(filter);
					return filter.connection ? {
						'connection': filter.connection
					} : {
						'hydratedConnection.provider_name': {
							$regex: new RegExp(filter.provider_name, 'i')
						}
					};
				});

				if (contactPostLookupMatch.$and == null) {
					contactPostLookupMatch.$and = [];
				}

				contactPostLookupMatch.$and.push({
					$or: lookupConnectorFilters
				});
			}

			contactAggregation
				.match(contactPreLookupMatch)
				.lookup($connectionLookup)
				.unwind('$hydratedConnection')
				.match(contactPostLookupMatch)
				.project({
					_id: true
				});

			let aggregatedContact = await contactAggregation.exec();

			let contactIds = [];

			if (aggregatedContact.length > 0) {
				_.each(aggregatedContact, function (contact) {
					contactIds.push(contact._id);
				});
			}

			let filter = {
				user_id_string: context.req.user._id.toString('hex'),
				_id: {
					$in: contactIds
				}
			};

			let contactMatches = await ContactTC.getResolver('findMany').resolve({
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
					avatar_url: true,
					handle: true,
					name: true,
					tagMasks: true
				}
			});

			let contactMatchCount = await ContactTC.getResolver('count').resolve({
				args: {
					filter: filter,
					sort: sort,
					limit: query.limit,
					offset: query.offset
				}
			});

			documents = contactMatches;
			count = contactMatchCount;

		}
		else {
			let filter = {
				user_id_string: context.req.user._id.toString('hex')
			};

			if (query.sortField === 'name') {
				filter.name = {
					$nin: [null, '']
				};
			}

			if (query.sortField === 'handle') {
				filter.handle = {
					$nin: [null, '']
				};
			}

			let contactMatches = await ContactTC.getResolver('findMany').resolve({
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
					avatar_url: true,
					handle: true,
					name: true,
					tagMasks: true
				}
			});

			let contactMatchCount = await ContactTC.getResolver('count').resolve({
				args: {
					filter: filter,
					sort: sort,
					limit: query.limit,
					offset: query.offset
				},
			});

			documents = contactMatches;
			count = contactMatchCount;
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