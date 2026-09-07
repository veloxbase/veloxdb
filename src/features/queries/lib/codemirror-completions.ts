import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { snippet } from "@codemirror/autocomplete";
import type { QueryEditorMetadata } from "@/data/types";

/**
 * Builds the schema object required by `@codemirror/lang-sql`.
 * Maps table names and fully qualified table names to lists of column names.
 */
export function buildSqlSchema(metadata?: QueryEditorMetadata): {
	schema: Record<string, (string | Completion)[]>;
	tables: Completion[];
} {
	if (!metadata || !metadata.tables.length) {
		return { schema: {}, tables: [] };
	}

	const schema: Record<string, (string | Completion)[]> = {};
	const tables: Completion[] = [];

	for (const table of metadata.tables) {
		const fqTable = `${table.schema}.${table.name}`;
		const columns: Completion[] = table.columns.map((col) => ({
			label: col.name,
			type: "property",
			detail: col.dataType,
			boost: 1,
		}));

		schema[table.name] = columns;
		schema[fqTable] = columns;

		tables.push({
			label: table.name,
			type: "class",
			detail: `table (${table.schema})`,
			boost: 2,
		});

		if (table.schema && table.schema !== "public" && table.schema !== "main") {
			tables.push({
				label: fqTable,
				type: "class",
				detail: "table",
				boost: 1,
			});
		}
	}

	return { schema, tables };
}

const MONGO_METHODS: { label: string; template: string; detail: string; info: string }[] = [
	{
		label: "find",
		template: "find(${1:{}})",
		detail: "find(filter, projection)",
		info: "Selects documents in a collection and returns a cursor to the selected documents.",
	},
	{
		label: "findOne",
		template: "findOne(${1:{}})",
		detail: "findOne(filter, projection)",
		info: "Returns one document that satisfies the specified query criteria.",
	},
	{
		label: "aggregate",
		template: "aggregate([\n  ${1:{\\$match: {\\}}}\n])",
		detail: "aggregate(pipeline)",
		info: "Calculates aggregate values for the data in a collection or a view.",
	},
	{
		label: "countDocuments",
		template: "countDocuments(${1:{}})",
		detail: "countDocuments(filter)",
		info: "Returns the count of documents that match the query for a collection or view.",
	},
	{
		label: "distinct",
		template: "distinct(\"${1:field}\", ${2:{}})",
		detail: "distinct(field, filter)",
		info: "Finds the distinct values for a specified field across a single collection.",
	},
	{
		label: "insertOne",
		template: "insertOne(${1:{}})",
		detail: "insertOne(document)",
		info: "Inserts a single document into a collection.",
	},
	{
		label: "insertMany",
		template: "insertMany([${1:{}}])",
		detail: "insertMany([documents])",
		info: "Inserts multiple documents into a collection.",
	},
	{
		label: "updateOne",
		template: "updateOne(${1:{}}, { \\$set: { ${2:field}: ${3:value} } })",
		detail: "updateOne(filter, update)",
		info: "Updates a single document within the collection based on the filter.",
	},
	{
		label: "updateMany",
		template: "updateMany(${1:{}}, { \\$set: { ${2:field}: ${3:value} } })",
		detail: "updateMany(filter, update)",
		info: "Updates all documents that match the specified filter for a collection.",
	},
	{
		label: "deleteOne",
		template: "deleteOne(${1:{}})",
		detail: "deleteOne(filter)",
		info: "Removes a single document from a collection.",
	},
	{
		label: "deleteMany",
		template: "deleteMany(${1:{}})",
		detail: "deleteMany(filter)",
		info: "Removes all documents that match the specified filter from a collection.",
	},
	{
		label: "limit",
		template: "limit(${1:100})",
		detail: "limit(number)",
		info: "Specifies the maximum number of documents the cursor will return.",
	},
	{
		label: "skip",
		template: "skip(${1:0})",
		detail: "skip(number)",
		info: "Specifies the number of documents to skip before returning results.",
	},
	{
		label: "sort",
		template: "sort({ ${1:field}: 1 })",
		detail: "sort(specification)",
		info: "Specifies the order in which the query returns matching documents.",
	},
	{
		label: "project",
		template: "project({ ${1:field}: 1 })",
		detail: "project(specification)",
		info: "Specifies the fields to include or exclude from the returned documents.",
	},
];

const MONGO_OPERATORS: { label: string; detail: string; template: string; info: string }[] = [
	// Comparison
	{ label: "$eq", detail: "Matches values that are equal", template: "\\$eq: ${1:value}", info: "Matches values that are equal to a specified value." },
	{ label: "$gt", detail: "Matches values that are greater", template: "\\$gt: ${1:value}", info: "Matches values that are greater than a specified value." },
	{ label: "$gte", detail: "Matches values >= specified", template: "\\$gte: ${1:value}", info: "Matches values that are greater than or equal to a specified value." },
	{ label: "$in", detail: "Matches any of values in array", template: "\\$in: [${1:value}]", info: "Matches any of the values specified in an array." },
	{ label: "$lt", detail: "Matches values that are less", template: "\\$lt: ${1:value}", info: "Matches values that are less than a specified value." },
	{ label: "$lte", detail: "Matches values <= specified", template: "\\$lte: ${1:value}", info: "Matches values that are less than or equal to a specified value." },
	{ label: "$ne", detail: "Matches values not equal", template: "\\$ne: ${1:value}", info: "Matches all values that are not equal to a specified value." },
	{ label: "$nin", detail: "Matches none of values in array", template: "\\$nin: [${1:value}]", info: "Matches none of the values specified in an array." },
	// Logical
	{ label: "$and", detail: "Joins query clauses with AND", template: "\\$and: [\n  { ${1:field}: ${2:value} },\n  { ${3:field}: ${4:value} }\n]", info: "Joins query clauses with a logical AND." },
	{ label: "$or", detail: "Joins query clauses with OR", template: "\\$or: [\n  { ${1:field}: ${2:value} },\n  { ${3:field}: ${4:value} }\n]", info: "Joins query clauses with a logical OR." },
	{ label: "$not", detail: "Inverts effect of query expression", template: "\\$not: { ${1:\\$gt}: ${2:value} }", info: "Inverts the effect of a query expression." },
	{ label: "$nor", detail: "Joins clauses with NOR", template: "\\$nor: [{ ${1:field}: ${2:value} }]", info: "Joins query clauses with a logical NOR." },
	// Element
	{ label: "$exists", detail: "Matches documents with field", template: "\\$exists: ${1:true}", info: "Matches documents that have the specified field." },
	{ label: "$type", detail: "Selects documents by BSON type", template: "\\$type: \"${1:string}\"", info: "Selects documents if a field is of the specified type." },
	// Evaluation
	{ label: "$regex", detail: "Selects documents by regex", template: "\\$regex: /${1:pattern}/i", info: "Selects documents where values match a specified regular expression." },
	{ label: "$expr", detail: "Allows aggregation expressions", template: "\\$expr: { ${1:\\$gt}: [\"$${2:field1}\", \"$${3:field2}\"] }", info: "Allows the use of aggregation expressions within the query language." },
	// Array
	{ label: "$all", detail: "Matches arrays containing all elements", template: "\\$all: [${1:value}]", info: "Matches arrays that contain all elements specified in the query." },
	{ label: "$elemMatch", detail: "Matches array element satisfying criteria", template: "\\$elemMatch: { ${1:field}: ${2:value} }", info: "Selects documents if element in the array field matches all the specified conditions." },
	{ label: "$size", detail: "Matches array length", template: "\\$size: ${1:count}", info: "Selects documents if the array field is a specified size." },
	// Update
	{ label: "$set", detail: "Sets the value of a field", template: "\\$set: { ${1:field}: ${2:value} }", info: "Sets the value of a field in a document." },
	{ label: "$unset", detail: "Removes specified field", template: "\\$unset: { ${1:field}: \"\" }", info: "Deletes the specified field from a document." },
	{ label: "$inc", detail: "Increments field by amount", template: "\\$inc: { ${1:field}: ${2:1} }", info: "Increments the value of the field by the specified amount." },
	{ label: "$push", detail: "Appends value to array", template: "\\$push: { ${1:field}: ${2:value} }", info: "Appends a specified value to an array." },
	{ label: "$pull", detail: "Removes matching values from array", template: "\\$pull: { ${1:field}: ${2:value} }", info: "Removes all array elements that match a specified query." },
	{ label: "$addToSet", detail: "Adds elements to array if absent", template: "\\$addToSet: { ${1:field}: ${2:value} }", info: "Adds elements to an array only if they do not already exist in the set." },
	// Aggregation Stages
	{ label: "$match", detail: "Pipeline: filters documents", template: "\\$match: { ${1:field}: ${2:value} }", info: "Filters the documents to pass only the documents that match the specified condition(s)." },
	{ label: "$group", detail: "Pipeline: groups documents", template: "\\$group: {\n  _id: \"$${1:field}\",\n  ${2:count}: { \\$sum: 1 }\n}", info: "Groups input documents by the specified _id expression and applies accumulator expressions." },
	{ label: "$project", detail: "Pipeline: reshapes documents", template: "\\$project: {\n  ${1:field}: 1\n}", info: "Passes along the documents with the requested fields to the next stage in the pipeline." },
	{ label: "$sort", detail: "Pipeline: sorts documents", template: "\\$sort: { ${1:field}: 1 }", info: "Reorders the document stream by a specified sort key." },
	{ label: "$limit", detail: "Pipeline: limits document count", template: "\\$limit: ${1:100}", info: "Passes the first n documents unmodified to the pipeline where n is the specified limit." },
	{ label: "$skip", detail: "Pipeline: skips documents", template: "\\$skip: ${1:10}", info: "Skips over the specified number of documents that pass into the stage." },
	{ label: "$unwind", detail: "Pipeline: deconstructs array field", template: "\\$unwind: \"$${1:arrayField}\"", info: "Deconstructs an array field from the input documents to output a document for each element." },
	{ label: "$lookup", detail: "Pipeline: left outer join", template: "\\$lookup: {\n  from: \"${1:fromCollection}\",\n  localField: \"${2:localField}\",\n  foreignField: \"${3:foreignField}\",\n  as: \"${4:asField}\"\n}", info: "Performs a left outer join to an unsharded collection in the same database." },
	{ label: "$addFields", detail: "Pipeline: adds new fields", template: "\\$addFields: { ${1:newField}: ${2:expression} }", info: "Adds new fields to documents." },
];

/**
 * Creates an intelligent autocompletion source for MongoDB shell queries.
 */
export function createMongoCompletionSource(metadata?: QueryEditorMetadata): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const docBefore = context.matchBefore(/[\w$.'"]*/);
		if (!docBefore) return null;

		const line = context.state.doc.lineAt(context.pos);
		const lineTextBefore = line.text.slice(0, context.pos - line.from);

		// 1. Check for `db.` trigger: suggest collections
		const dbMatch = lineTextBefore.match(/(?:^|[^\w])db\.([\w]*)$/);
		if (dbMatch) {
			const word = dbMatch[1] ?? "";
			const from = context.pos - word.length;
			const options: Completion[] = (metadata?.tables ?? []).map((t) => ({
				label: t.name,
				type: "class",
				detail: "collection",
				boost: 3,
			}));
			return {
				from,
				options,
				validFor: /^[\w]*$/,
			};
		}

		// 2. Check for `db.<collection>.` or `<collection>.`: suggest Mongo methods
		const methodMatch = lineTextBefore.match(/(?:db\.)?([\w]+)\.([\w]*)$/);
		if (methodMatch) {
			const word = methodMatch[2] ?? "";
			const from = context.pos - word.length;
			const options: Completion[] = MONGO_METHODS.map((m) => ({
				label: m.label,
				apply: snippet(m.template),
				type: "method",
				detail: m.detail,
				info: m.info,
				boost: 2,
			}));
			return {
				from,
				options,
				validFor: /^[\w]*$/,
			};
		}

		// 3. Check for `$` trigger: suggest MongoDB operators
		const operatorMatch = lineTextBefore.match(/(?:["']?)(\$[\w]*)$/);
		if (operatorMatch) {
			const opWord = operatorMatch[1] ?? "";
			const from = context.pos - opWord.length;
			const options: Completion[] = MONGO_OPERATORS.map((op) => ({
				label: op.label,
				apply: snippet(op.template),
				type: "keyword",
				detail: op.detail,
				info: op.info,
				boost: 2,
			}));
			return {
				from,
				options,
				validFor: /^\$[\w]*$/,
			};
		}

		// 4. Inside query object or typing identifier: suggest collection fields & collections
		const wordMatch = context.matchBefore(/[\w]+/);
		if (wordMatch || context.explicit) {
			const from = wordMatch ? wordMatch.from : context.pos;
			const options: Completion[] = [];

			// Detect target collection name from document
			const fullDoc = context.state.doc.toString();
			const collMatch = fullDoc.match(/(?:db\.)?([a-zA-Z0-9_]+)\.(?:find|aggregate|findOne|countDocuments|updateOne|updateMany|deleteOne|deleteMany)/);
			const targetColl = collMatch ? collMatch[1] : null;

			if (metadata?.tables) {
				for (const table of metadata.tables) {
					const isTarget = targetColl ? table.name === targetColl : true;
					for (const col of table.columns) {
						options.push({
							label: col.name,
							type: "property",
							detail: `${table.name} · ${col.dataType}`,
							boost: isTarget ? 3 : 1,
						});
					}
				}
			}

			// Add top-level `db` keyword
			options.push({
				label: "db",
				type: "keyword",
				detail: "database reference",
				boost: 4,
			});

			// Add BSON constructor snippets
			options.push({
				label: "ObjectId",
				apply: snippet("ObjectId(\"${1}\")"),
				type: "function",
				detail: "ObjectId(hexString)",
				boost: 2,
			});
			options.push({
				label: "ISODate",
				apply: snippet("ISODate(\"${1}\")"),
				type: "function",
				detail: "ISODate(dateString)",
				boost: 2,
			});

			return {
				from,
				options,
				validFor: /^[\w]*$/,
			};
		}

		return null;
	};
}

const REDIS_COMMANDS: { label: string; detail: string; snippet: string }[] = [
	{ label: "GET", detail: "GET key", snippet: "GET ${1:key}" },
	{ label: "SET", detail: "SET key value [EX seconds]", snippet: "SET ${1:key} \"${2:value}\"" },
	{ label: "DEL", detail: "DEL key [key ...]", snippet: "DEL ${1:key}" },
	{ label: "EXISTS", detail: "EXISTS key [key ...]", snippet: "EXISTS ${1:key}" },
	{ label: "EXPIRE", detail: "EXPIRE key seconds", snippet: "EXPIRE ${1:key} ${2:60}" },
	{ label: "TTL", detail: "TTL key", snippet: "TTL ${1:key}" },
	{ label: "KEYS", detail: "KEYS pattern", snippet: "KEYS \"${1:*}\"" },
	{ label: "SCAN", detail: "SCAN cursor [MATCH pattern] [COUNT count]", snippet: "SCAN ${1:0} MATCH \"${2:*}\" COUNT ${3:100}" },
	{ label: "TYPE", detail: "TYPE key", snippet: "TYPE ${1:key}" },
	{ label: "HGET", detail: "HGET key field", snippet: "HGET ${1:key} ${2:field}" },
	{ label: "HSET", detail: "HSET key field value", snippet: "HSET ${1:key} ${2:field} \"${3:value}\"" },
	{ label: "HGETALL", detail: "HGETALL key", snippet: "HGETALL ${1:key}" },
	{ label: "HDEL", detail: "HDEL key field [field ...]", snippet: "HDEL ${1:key} ${2:field}" },
	{ label: "LPUSH", detail: "LPUSH key element [element ...]", snippet: "LPUSH ${1:key} \"${2:value}\"" },
	{ label: "RPUSH", detail: "RPUSH key element [element ...]", snippet: "RPUSH ${1:key} \"${2:value}\"" },
	{ label: "LPOP", detail: "LPOP key [count]", snippet: "LPOP ${1:key}" },
	{ label: "RPOP", detail: "RPOP key [count]", snippet: "RPOP ${1:key}" },
	{ label: "LRANGE", detail: "LRANGE key start stop", snippet: "LRANGE ${1:key} ${2:0} ${3:-1}" },
	{ label: "LLEN", detail: "LLEN key", snippet: "LLEN ${1:key}" },
	{ label: "SADD", detail: "SADD key member [member ...]", snippet: "SADD ${1:key} \"${2:member}\"" },
	{ label: "SMEMBERS", detail: "SMEMBERS key", snippet: "SMEMBERS ${1:key}" },
	{ label: "SREM", detail: "SREM key member [member ...]", snippet: "SREM ${1:key} \"${2:member}\"" },
	{ label: "PING", detail: "PING [message]", snippet: "PING" },
	{ label: "INFO", detail: "INFO [section]", snippet: "INFO" },
	{ label: "DBSIZE", detail: "DBSIZE", snippet: "DBSIZE" },
	{ label: "FLUSHDB", detail: "FLUSHDB [ASYNC|SYNC]", snippet: "FLUSHDB" },
];

/**
 * Autocompletion source for Redis CLI commands.
 */
export function createRedisCompletionSource(): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const word = context.matchBefore(/[\w-]*/);
		if (!word) return null;
		if (word.from === word.to && !context.explicit) return null;

		return {
			from: word.from,
			options: REDIS_COMMANDS.map((cmd) => ({
				label: cmd.label,
				apply: snippet(cmd.snippet),
				type: "keyword",
				detail: cmd.detail,
			})),
			validFor: /^[\w-]*$/i,
		};
	};
}
