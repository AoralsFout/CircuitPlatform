#include "circuit/protocol.hpp"

#include <charconv>
#include <cstddef>
#include <utility>

namespace circuit::protocol {
namespace {

bool isJsonSpace(char character) {
    return character == ' ' || character == '\t' || character == '\n' || character == '\r';
}

std::size_t skipWhitespace(std::string_view json, std::size_t position) {
    while (position < json.size() && isJsonSpace(json[position])) {
        ++position;
    }
    return position;
}

/**
 * 读取一个 JSON 字符串字面量。
 * @param json 要扫描的文本。
 * @param position 起始位置，可以是字符串前的空白。
 * @return 内容（已还原转义）与闭引号之后的位置；不是字符串时返回空值。
 */
std::optional<std::pair<std::string, std::size_t>> readString(
    std::string_view json, std::size_t position) {
    position = skipWhitespace(json, position);
    if (position >= json.size() || json[position] != '"') {
        return std::nullopt;
    }
    ++position;

    std::string result;
    while (position < json.size()) {
        const char character = json[position++];
        if (character == '"') {
            return std::make_pair(std::move(result), position);
        }
        if (character == '\\' && position < json.size()) {
            const char escaped = json[position++];
            switch (escaped) {
            case '"': result.push_back('"'); break;
            case '\\': result.push_back('\\'); break;
            case 'n': result.push_back('\n'); break;
            case 'r': result.push_back('\r'); break;
            case 't': result.push_back('\t'); break;
            default: result.push_back(escaped); break;
            }
            continue;
        }
        result.push_back(character);
    }

    return std::nullopt;
}

/**
 * 跳过一个完整的 JSON 值，返回它之后的位置。
 *
 * 容器按括号配对跳过，字符串整体跳过——这样 `}` 或某个键名出现在字符串字面量里都不会被
 * 当成结构的一部分。这是本文件能安全读取嵌套的 `ports` 数组的前提：早先按子串查找字段的
 * 写法在嵌套结构上会命中字符串里的同名文本。
 * @param json 要扫描的文本。
 * @param position 起始位置，可以是值前的空白。
 * @return 值之后的位置；值不完整时返回空值。
 */
std::optional<std::size_t> skipValue(std::string_view json, std::size_t position) {
    position = skipWhitespace(json, position);
    if (position >= json.size()) {
        return std::nullopt;
    }

    const char opening = json[position];
    if (opening == '"') {
        const auto text = readString(json, position);
        return text.has_value() ? std::optional{text->second} : std::nullopt;
    }

    if (opening == '{' || opening == '[') {
        const char closing = opening == '{' ? '}' : ']';
        std::size_t depth = 0;
        while (position < json.size()) {
            const char current = json[position];
            if (current == '"') {
                const auto text = readString(json, position);
                if (!text.has_value()) {
                    return std::nullopt;
                }
                position = text->second;
                continue;
            }
            ++position;
            if (current == opening) {
                ++depth;
            } else if (current == closing) {
                --depth;
                if (depth == 0) {
                    return position;
                }
            }
        }
        return std::nullopt;
    }

    // 数字与 true / false / null：读到分隔符为止。
    const auto begin = position;
    while (position < json.size() && json[position] != ',' && json[position] != '}' &&
           json[position] != ']' && !isJsonSpace(json[position])) {
        ++position;
    }
    return begin == position ? std::nullopt : std::optional{position};
}

/**
 * 在一层对象里按成员名取值的原始文本。
 * @param object 一段以 `{` 开头的对象文本。
 * @param key 成员名。
 * @return 成员值的原始文本（可能是一整段数组或对象）；成员不存在时返回空值。
 */
std::optional<std::string_view> memberValue(std::string_view object, std::string_view key) {
    auto position = skipWhitespace(object, 0);
    if (position >= object.size() || object[position] != '{') {
        return std::nullopt;
    }
    ++position;

    while (true) {
        position = skipWhitespace(object, position);
        if (position >= object.size() || object[position] == '}') {
            return std::nullopt;
        }

        const auto name = readString(object, position);
        if (!name.has_value()) {
            return std::nullopt;
        }
        position = skipWhitespace(object, name->second);
        if (position >= object.size() || object[position] != ':') {
            return std::nullopt;
        }
        position = skipWhitespace(object, position + 1);

        const auto end = skipValue(object, position);
        if (!end.has_value()) {
            return std::nullopt;
        }
        if (name->first == key) {
            return object.substr(position, *end - position);
        }

        position = skipWhitespace(object, *end);
        if (position < object.size() && object[position] == ',') {
            ++position;
            continue;
        }
        return std::nullopt;
    }
}

// 取字符串字段；值不是字符串时视为字段不存在，与旧行为一致。
std::optional<std::string> stringField(std::string_view json, std::string_view key) {
    const auto value = memberValue(json, key);
    if (!value.has_value()) {
        return std::nullopt;
    }
    const auto text = readString(*value, 0);
    if (!text.has_value() || skipWhitespace(*value, text->second) != value->size()) {
        return std::nullopt;
    }
    return text->first;
}

// 取非负整数字段；负数、小数与指数形式都不是这个字段要的形状。
std::optional<std::uint64_t> numberField(std::string_view json, std::string_view key) {
    const auto value = memberValue(json, key);
    if (!value.has_value()) {
        return std::nullopt;
    }
    if (value->find_first_not_of("0123456789") != std::string_view::npos) {
        return std::nullopt;
    }

    std::uint64_t parsed{};
    const auto result = std::from_chars(value->data(), value->data() + value->size(), parsed);
    return result.ec == std::errc{} ? std::optional{parsed} : std::nullopt;
}

// 取数组字段的各个元素文本；元素本身可能是对象，交给成员扫描逐项读取。
std::optional<std::vector<std::string_view>> arrayElements(std::string_view value) {
    auto position = skipWhitespace(value, 0);
    if (position >= value.size() || value[position] != '[') {
        return std::nullopt;
    }
    position = skipWhitespace(value, position + 1);
    if (position < value.size() && value[position] == ']') {
        return std::vector<std::string_view>{};
    }

    std::vector<std::string_view> elements;
    while (true) {
        const auto end = skipValue(value, position);
        if (!end.has_value()) {
            return std::nullopt;
        }
        elements.push_back(value.substr(position, *end - position));

        position = skipWhitespace(value, *end);
        if (position < value.size() && value[position] == ',') {
            position = skipWhitespace(value, position + 1);
            continue;
        }
        return position < value.size() && value[position] == ']'
                   ? std::optional{elements}
                   : std::nullopt;
    }
}

// 解析一份端口声明；形状不合法时返回空值，由调用方把整个字段标成不合法。
std::optional<PortSpec> portSpecFromElement(std::string_view element) {
    const auto name = stringField(element, "name");
    const auto direction = stringField(element, "direction");
    const auto width = numberField(element, "width");
    if (!name.has_value() || !direction.has_value() || !width.has_value()) {
        return std::nullopt;
    }

    PortSpec spec{.name = *name, .direction = *direction, .width = *width, .bitRange = std::nullopt};

    const auto range = memberValue(element, "bitRange");
    if (range.has_value()) {
        const auto msb = numberField(*range, "msb");
        const auto lsb = numberField(*range, "lsb");
        if (!msb.has_value() || !lsb.has_value()) {
            return std::nullopt;
        }
        spec.bitRange = BitRangeSpec{*msb, *lsb};
    }

    return spec;
}

PortListField parsePortListField(std::string_view json) {
    const auto value = memberValue(json, "ports");
    if (!value.has_value()) {
        return PortListField{.present = false, .wellFormed = true, .ports = {}};
    }

    const auto elements = arrayElements(*value);
    if (!elements.has_value()) {
        return PortListField{.present = true, .wellFormed = false, .ports = {}};
    }

    std::vector<PortSpec> ports;
    ports.reserve(elements->size());
    for (const auto element : *elements) {
        const auto spec = portSpecFromElement(element);
        if (!spec.has_value()) {
            return PortListField{.present = true, .wellFormed = false, .ports = {}};
        }
        ports.push_back(*spec);
    }

    return PortListField{.present = true, .wellFormed = true, .ports = std::move(ports)};
}

}  // namespace

std::optional<Request> parseRequest(std::string_view json) {
    const auto type = stringField(json, "type");
    const auto requestId = stringField(json, "requestId");
    if (!type.has_value() || !requestId.has_value()) {
        return std::nullopt;
    }

    return Request{
        .type = *type,
        .requestId = *requestId,
        .kind = stringField(json, "kind"),
        .componentId = numberField(json, "componentId"),
        .connectionId = numberField(json, "connectionId"),
        .port = stringField(json, "port"),
        .sourceComponentId = numberField(json, "sourceComponentId"),
        .sourcePort = stringField(json, "sourcePort"),
        .targetComponentId = numberField(json, "targetComponentId"),
        .targetPort = stringField(json, "targetPort"),
        // 信号值统一是字符串：只接受 JSON 字符串字面量。数字形式是「0/1 是数字、X 是字符串」
        // 那个混用表示的遗留，数字也无法表达多位值，因此不再回退到它。
        .value = stringField(json, "value"),
        .ports = parsePortListField(json),
    };
}

std::string escapeJson(std::string_view value) {
    std::string result;
    for (const char character : value) {
        switch (character) {
        case '"': result += "\\\""; break;
        case '\\': result += "\\\\"; break;
        case '\n': result += "\\n"; break;
        case '\r': result += "\\r"; break;
        case '\t': result += "\\t"; break;
        default: result.push_back(character); break;
        }
    }
    return result;
}

std::string errorResponse(
    std::string_view requestId, std::string_view code, std::string_view message) {
    return "{\"type\":\"error\",\"requestId\":\"" + escapeJson(requestId) +
           "\",\"code\":\"" + escapeJson(code) + "\",\"message\":\"" +
           escapeJson(message) + "\"}";
}

}  // namespace circuit::protocol
