#include "circuit/request_handler.hpp"

#include <algorithm>
#include <cstddef>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace circuit {
namespace {

// 将协议中的稳定名称映射到领域枚举，避免协议字符串进入仿真核心。
std::optional<ComponentKind> componentKindFromName(std::string_view name) {
    if (name == "input") return ComponentKind::Input;
    if (name == "output") return ComponentKind::Output;
    if (name == "and") return ComponentKind::AndGate;
    if (name == "or") return ComponentKind::OrGate;
    if (name == "nand") return ComponentKind::NandGate;
    if (name == "nor") return ComponentKind::NorGate;
    if (name == "xor") return ComponentKind::XorGate;
    if (name == "xnor") return ComponentKind::XnorGate;
    if (name == "not") return ComponentKind::NotGate;
    if (name == "clock") return ComponentKind::Clock;
    if (name == "d_flip_flop") return ComponentKind::DFlipFlop;
    if (name == "splitter") return ComponentKind::Splitter;
    if (name == "merger") return ComponentKind::Merger;
    return std::nullopt;
}

/**
 * 把协议里的信号值文本翻译成领域值。
 * @param value 逐位文本，每一位取 `0` / `1` / `X`。
 * @return 合法时返回领域值；空串或含其它字符时返回空值。
 */
std::optional<SignalValue> signalValueFromName(std::string_view value) {
    if (value.empty() || value.find_first_not_of("01X") != std::string_view::npos) {
        return std::nullopt;
    }
    return SignalValue::fromBits(std::string(value));
}

// 信号值出协议时统一是字符串，逐位文本因此直接加引号。文本只含 `0` / `1` / `X`，
// 没有需要转义的字符。
std::string signalValueToJson(const SignalValue& value) {
    return "\"" + value.bits() + "\"";
}

std::string responseWithId(std::string_view type, std::string_view requestId) {
    return "{\"type\":\"" + protocol::escapeJson(type) +
           "\",\"requestId\":\"" + protocol::escapeJson(requestId) + "\"";
}

std::string missingField(const protocol::Request& request, std::string_view field) {
    return protocol::errorResponse(
        request.requestId, "bad_request", "缺少字段: " + std::string(field));
}

std::optional<std::uint32_t> toPortWidth(std::uint64_t value) {
    if (value == 0 || value > std::numeric_limits<std::uint32_t>::max()) {
        return std::nullopt;
    }
    return static_cast<std::uint32_t>(value);
}

// 位区间的两端是从 0 开始的位序号，因此 0 是合法取值；只有超出范围才拒绝。
std::optional<std::uint32_t> toBitIndex(std::uint64_t value) {
    if (value > std::numeric_limits<std::uint32_t>::max()) {
        return std::nullopt;
    }
    return static_cast<std::uint32_t>(value);
}

/** 端口清单翻译的结果：要么是一份领域端口清单，要么是一条可展示的错误。 */
struct PortListResult {
    std::optional<std::vector<Port>> ports;
    std::string code;
    std::string message;
};

/**
 * 把协议里的端口清单翻译成领域端口，并逐项校验。
 *
 * 校验分两层：方向名、位宽取值、重复端口名这些是清单本身能不能成立的问题；位宽与位区间是否
 * 自洽交给 `validatePort`，因为那是端口的领域规则，与协议形状无关。
 * @param specs 协议层解析出的端口声明。
 * @return 全部合法时返回领域端口清单，否则返回应报告的错误码与文案。
 */
PortListResult portListFromSpecs(const std::vector<protocol::PortSpec>& specs) {
    std::vector<Port> ports;
    ports.reserve(specs.size());

    for (const auto& spec : specs) {
        PortDirection direction{};
        if (spec.direction == "input") {
            direction = PortDirection::Input;
        } else if (spec.direction == "output") {
            direction = PortDirection::Output;
        } else {
            return {{}, "bad_request", "端口方向必须是 input 或 output"};
        }

        const auto width = toPortWidth(spec.width);
        if (!width.has_value()) {
            return {{}, "invalid_width", "端口位宽必须是正整数"};
        }

        Port port{.name = spec.name, .direction = direction, .width = *width, .bitRange = std::nullopt};
        if (spec.bitRange.has_value()) {
            const auto msb = toBitIndex(spec.bitRange->msb);
            const auto lsb = toBitIndex(spec.bitRange->lsb);
            if (!msb.has_value() || !lsb.has_value()) {
                return {{}, "invalid_bit_range", "位区间的两端必须是非负整数"};
            }
            port.bitRange = PortBitRange{*msb, *lsb};
        }

        // 重名的端口会让 PortId 指不到唯一一个端口，这份清单因此不成立。
        const auto duplicate = std::find_if(
            ports.begin(), ports.end(),
            [&port](const Port& existing) { return existing.name == port.name; });
        if (duplicate != ports.end()) {
            return {{}, "bad_request", "端口清单里的端口名不能重复"};
        }

        // toPortWidth 已经把 0 挡在上面了，因此 validatePort 在这里只可能报位区间的问题，
        // 它那条 InvalidWidth 分支在这个调用点不可达。
        if (validatePort(port) == PortError::InvalidBitRange) {
            return {{}, "invalid_bit_range", "位区间必须满足 msb >= lsb，且位宽等于 msb - lsb + 1"};
        }
        ports.push_back(std::move(port));
    }

    return {std::move(ports), "", ""};
}

/** 端口清单的领域校验结果，翻译成可展示的协议错误；合法时 `error` 为假。 */
struct PortListProblem {
    bool error{false};
    std::string code;
    std::string message;
};

/**
 * 用端口清单对某个元件类型的形状规则整体校验一份清单，并把领域错误翻译成协议错误。
 *
 * 两条规则共用同一个错误码域：越界、重叠、漏位三者各有一条文案，用户需要知道是写超了、压住了
 * 别人、还是漏了几位，而调用方只需要按一个码判断「这份清单不能用」；形状不对则按元件类型分成
 * 两种文案——数据驱动的两个元件要的是宿主总线加分支，其余类型要的是与内置定义一致。
 * @param kind 清单所属的元件类型。
 * @param ports 翻译后的完整端口清单。
 * @return 合法时返回 `error == false` 的结果，否则返回错误码与文案。
 */
PortListProblem portListProblem(ComponentKind kind, const std::vector<Port>& ports) {
    switch (validatePortList(kind, ports)) {
    case PortListError::None:
        return {};
    case PortListError::Malformed:
        return {true, "bad_request",
                "端口清单必须是一条不带位区间的宿主总线端口，加若干条方向相反的位区间分支"};
    case PortListError::NotBuiltinShape:
        // 内置类型的端口形状就是规格里那份固定定义：数量、名称、方向都不能改，能改的只有
        // Input 与 Output 的位宽。清单对不上是调用方写错了，不是引擎有可选的第二套形状。
        return {true, "bad_request",
                "端口清单必须与内置定义一致；只有 Input 与 Output 的位宽可以不同"};
    case PortListError::OutOfRange:
        return {true, "invalid_bit_range", "位区间越出了宿主总线的位范围"};
    case PortListError::Overlap:
        return {true, "invalid_bit_range", "位区间不能互相重叠"};
    case PortListError::Incomplete:
        return {true, "invalid_bit_range", "位区间必须完整覆盖宿主总线的每一位，不能漏位"};
    }

    return {};
}

// 端口清单的出协议形状与 `component_added` / `port_width_set` 共用一份，避免两处漂移。
std::string portListToJson(const std::vector<Port>& ports) {
    std::string result = "[";
    bool first = true;
    for (const auto& port : ports) {
        if (!first) result += ",";
        first = false;
        result += "{\"name\":\"" + protocol::escapeJson(port.name) + "\",\"direction\":\"" +
                  (port.direction == PortDirection::Input ? "input" : "output") +
                  "\",\"width\":" + std::to_string(port.width);
        if (port.bitRange.has_value()) {
            result += ",\"bitRange\":{\"msb\":" + std::to_string(port.bitRange->msb) +
                      ",\"lsb\":" + std::to_string(port.bitRange->lsb) + "}";
        }
        result += "}";
    }
    return result + "]";
}

// 读取一个元件当前的端口清单；元件不存在时给出空清单，调用方只在元件确实存在时使用它。
std::vector<Port> portsOf(const Circuit& circuit, ComponentId id) {
    const auto component = circuit.component(id);
    return component.has_value() ? component->ports : std::vector<Port>{};
}

// Input 元件唯一那个输出端口的位宽。长度校验因此读的是端口自己声明的位宽，而不是全局常量。
std::optional<std::uint32_t> inputPortWidth(const Circuit& circuit, ComponentId id) {
    const auto component = circuit.component(id);
    if (!component.has_value() || component->kind != ComponentKind::Input) {
        return std::nullopt;
    }

    const auto port = std::find_if(
        component->ports.begin(), component->ports.end(),
        [](const Port& candidate) { return candidate.name == "out"; });
    return port == component->ports.end() ? std::nullopt : std::optional{port->width};
}

// 从零建立一份仿真状态，等价于「刚创建时」的样子：全部输出回到初始值、Clock 回到 0、
// 每个 DFlipFlop 的 q 回到 X、步数归零。首次需要仿真时走这里；重置同样以它为基底。
void resetSimulation(const Circuit& circuit, std::optional<Simulation>& simulation) {
    simulation.emplace(circuit);
}

// 结构变化后按元件身份重新推导仿真状态，而不是重建整个快照。
// Simulation 持有对 Circuit 的引用，所以这里只需要重建状态表：仍然存在的 PortId 保留当前值，
// 消失的连同值一起丢弃，新出现的按初始值建立，已经积累的时序状态不受影响。
void reconcileSimulation(const Circuit& circuit, std::optional<Simulation>& simulation) {
    if (!simulation.has_value()) {
        resetSimulation(circuit, simulation);
        return;
    }

    simulation->reconcile();
}

}  // namespace

std::string handleRequest(
    const protocol::Request& request, const Engine& engine, Circuit& circuit,
    std::optional<Simulation>& simulation) {
    if (request.type == "health_check") {
        const auto status = engine.status();
        return responseWithId("health_check_result", request.requestId) +
               ",\"status\":\"ok\",\"engine\":\"" +
               protocol::escapeJson(std::string(status.name) + " " + std::string(status.version)) +
               "\"}";
    }

    if (request.type == "add_component") {
        if (!request.kind.has_value()) return missingField(request, "kind");
        const auto kind = componentKindFromName(*request.kind);
        if (!kind.has_value()) {
            return protocol::errorResponse(request.requestId, "invalid_kind", "不支持的元件类型");
        }

        // 端口清单是位宽的唯一权威来源：带着清单来就按清单建立，省略时回退到内置定义。
        // 前端对内置类型不自己写一份清单再发过来——那正好重建了本变更要消灭的第二份定义。
        //
        // **空数组是拒绝的，不回退到内置定义。** 规格只有「带清单」与「省略」两态，`ports: []`
        // 是规格没有的第三态，而它两种解释都不好：当作省略会让一个本想传清单、却把清单拼空了的
        // 调用方拿到一个形状完全不同的元件，还会让拆线器与合线器（没有内置定义可回退）与内置
        // 类型在同一份载荷上走出两条不同的路。因此它按形状错误报 `bad_request`——为内置类型
        // 空清单对不上内置定义，为数据驱动的两个元件空清单没有宿主总线。落到这条规则的实现上，
        // 引擎里没有「零端口元件」这个状态，也就不存在一个没有端口、永远无法连线的死件。
        ComponentId id{};
        if (!request.ports.present) {
            // 拆线器与合线器没有内置定义：总线多宽、分成几条分支、每条覆盖哪几位，全部由清单
            // 决定，省略清单就无从建立。内置类型相反——省略清单正是「引擎回退到内置定义」，
            // 因此这里只为这两个数据驱动的类型要求清单。
            if (*kind == ComponentKind::Splitter || *kind == ComponentKind::Merger) {
                return missingField(request, "ports");
            }
            id = circuit.addComponent(*kind);
        } else {
            if (!request.ports.wellFormed) {
                return protocol::errorResponse(
                    request.requestId, "bad_request", "ports 字段形状不合法");
            }
            const auto ports = portListFromSpecs(request.ports.ports);
            if (!ports.ports.has_value()) {
                return protocol::errorResponse(request.requestId, ports.code, ports.message);
            }
            // 逐条端口的规则之上还有一条整体规则：位区间要盖满宿主总线且互不重叠。清单不成立
            // 时元件根本没有被建立，因此不会留下一个半分好的拆线器。
            const auto problem = portListProblem(*kind, *ports.ports);
            if (problem.error) {
                return protocol::errorResponse(request.requestId, problem.code, problem.message);
            }
            id = circuit.addComponent(*kind, *ports.ports);
        }

        reconcileSimulation(circuit, simulation);
        // 回传该元件实际的端口清单，调用方因此不必内置一份无人校验的副本。
        return responseWithId("component_added", request.requestId) +
               ",\"componentId\":" + std::to_string(id) +
               ",\"ports\":" + portListToJson(portsOf(circuit, id)) + "}";
    }

    if (request.type == "set_port_width") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.ports.present) return missingField(request, "ports");
        if (!request.ports.wellFormed) {
            return protocol::errorResponse(request.requestId, "bad_request", "ports 字段形状不合法");
        }

        const auto ports = portListFromSpecs(request.ports.ports);
        if (!ports.ports.has_value()) {
            return protocol::errorResponse(request.requestId, ports.code, ports.message);
        }

        // 形状规则按元件当前的类型判定——内置类型要的是与内置定义一致，数据驱动的两个元件要的
        // 是盖满宿主总线的位区间——因此要先把类型读出来。这一步在写之前：一份不成立的清单不会
        // 落在任何元件上，改位宽因此是一次要么整体成立、要么什么都没发生的提交。
        const auto component = circuit.component(*request.componentId);
        if (component.has_value()) {
            const auto problem = portListProblem(component->kind, *ports.ports);
            if (problem.error) {
                return protocol::errorResponse(request.requestId, problem.code, problem.message);
            }
        }

        // 回传的是一份差分：本次改宽**造成**的悬空连接，即改宽前不悬空、改宽后悬空的那些。
        // 改宽前就因为端点缺失而悬空的连接不是这次变更的结果，调用方本来就知道它们。
        const auto danglingBefore = circuit.danglingConnections();
        if (!circuit.setComponentPorts(*request.componentId, *ports.ports)) {
            return protocol::errorResponse(request.requestId, "component_not_found", "找不到元件");
        }
        reconcileSimulation(circuit, simulation);

        std::string dangling = ",\"danglingConnectionIds\":[";
        bool first = true;
        for (const auto connectionId : circuit.danglingConnections()) {
            if (std::find(danglingBefore.begin(), danglingBefore.end(), connectionId) !=
                danglingBefore.end()) {
                continue;
            }
            if (!first) dangling += ",";
            first = false;
            dangling += std::to_string(connectionId);
        }
        dangling += "]";

        return responseWithId("port_width_set", request.requestId) +
               ",\"componentId\":" + std::to_string(*request.componentId) +
               ",\"ports\":" + portListToJson(portsOf(circuit, *request.componentId)) + dangling + "}";
    }

    if (request.type == "remove_component") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (*request.componentId == 0) {
            return protocol::errorResponse(
                request.requestId, "bad_request", "componentId 必须是正整数");
        }
        if (!circuit.removeComponent(*request.componentId)) {
            return protocol::errorResponse(request.requestId, "component_not_found", "找不到元件");
        }

        reconcileSimulation(circuit, simulation);
        return responseWithId("component_removed", request.requestId) +
               ",\"componentId\":" + std::to_string(*request.componentId) + "}";
    }

    if (request.type == "add_connection") {
        if (!request.sourceComponentId.has_value()) return missingField(request, "sourceComponentId");
        if (!request.sourcePort.has_value()) return missingField(request, "sourcePort");
        if (!request.targetComponentId.has_value()) return missingField(request, "targetComponentId");
        if (!request.targetPort.has_value()) return missingField(request, "targetPort");

        const auto result = circuit.addConnection(
            {*request.sourceComponentId, *request.sourcePort},
            {*request.targetComponentId, *request.targetPort});
        if (!result.succeeded()) {
            // 位宽不匹配是一个用户能修、也需要理解原因的拒绝，与「端点方向不对」这类
            // 编辑器不该发出的请求分开报告，调用方才能给出可展示的理由。
            if (result.error == ConnectionError::WidthMismatch) {
                return protocol::errorResponse(
                    request.requestId, "width_mismatch",
                    "两端端口位宽不同，不能直接连接；需要换宽度时用合线器显式构造");
            }
            return protocol::errorResponse(
                request.requestId, "invalid_connection", "连接端点不符合 Circuit 规则");
        }

        reconcileSimulation(circuit, simulation);
        return responseWithId("connection_added", request.requestId) +
               ",\"connectionId\":" + std::to_string(*result.id) + "}";
    }

    if (request.type == "remove_connection") {
        if (!request.connectionId.has_value()) return missingField(request, "connectionId");
        if (*request.connectionId == 0) {
            return protocol::errorResponse(
                request.requestId, "bad_request", "connectionId 必须是正整数");
        }
        if (!circuit.removeConnection(*request.connectionId)) {
            return protocol::errorResponse(request.requestId, "connection_not_found", "找不到连接");
        }

        reconcileSimulation(circuit, simulation);
        return responseWithId("connection_removed", request.requestId) +
               ",\"connectionId\":" + std::to_string(*request.connectionId) + "}";
    }

    if (request.type == "set_input") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.value.has_value()) return missingField(request, "value");
        // 长度先按字符集判定再按位宽判定：空串与含其它字符的值连信号值都不是，报 invalid_signal；
        // 只含 0/1/X 但长度不对的值本身合法，只是放不进这个端口，报 invalid_width。
        const auto value = signalValueFromName(*request.value);
        if (!value.has_value()) {
            return protocol::errorResponse(request.requestId, "invalid_signal", "信号值必须是 0、1 或 X");
        }

        const auto width = inputPortWidth(circuit, *request.componentId);
        if (!width.has_value()) {
            return protocol::errorResponse(request.requestId, "invalid_input", "目标元件不是有效的 Input");
        }
        if (value->width() != *width) {
            return protocol::errorResponse(
                request.requestId, "invalid_width", "信号值长度必须等于端口位宽");
        }

        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        if (!simulation->setInput(*request.componentId, *value)) {
            return protocol::errorResponse(request.requestId, "invalid_input", "目标元件不是有效的 Input");
        }

        return responseWithId("input_set", request.requestId) + "}";
    }

    if (request.type == "settle") {
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        const auto result = simulation->settle();
        if (!result.succeeded()) {
            return protocol::errorResponse(request.requestId, "combinational_loop", "检测到组合逻辑环路");
        }
        return responseWithId("settled", request.requestId) + ",\"status\":\"ok\"}";
    }

    if (request.type == "tick") {
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        const auto result = simulation->tick();
        if (!result.succeeded()) {
            return protocol::errorResponse(request.requestId, "combinational_loop", "检测到组合逻辑环路");
        }

        // 一次推进就把全部输出端口与每个 Output 接收端的当前值带回，运行循环每步只有一次跨进程往返。
        std::string signals = ",\"signals\":[";
        bool first = true;
        for (const auto& signal : simulation->signalSnapshot()) {
            if (!first) signals += ",";
            first = false;
            signals += "{\"componentId\":" + std::to_string(signal.port.component) +
                       ",\"port\":\"" + protocol::escapeJson(signal.port.name) + "\",\"value\":" +
                       signalValueToJson(signal.value) + "}";
        }
        signals += "]}";

        return responseWithId("ticked", request.requestId) +
               ",\"step\":" + std::to_string(simulation->step()) + signals;
    }

    if (request.type == "reset") {
        // 重置是一条独立请求，不是推进的一个参数：用户要能在任何时候单独表达「从头来过」，
        // 而不必借道某个带副作用的操作。它只清空运行时状态，Circuit 结构原样保留。
        // 没有仿真时先按当前 Circuit 建立再重置，结果与「重建一份仿真」完全一致。
        if (!simulation.has_value()) resetSimulation(circuit, simulation);
        simulation->reset();
        return responseWithId("reset_done", request.requestId) + ",\"status\":\"ok\"}";
    }

    if (request.type == "get_signal") {
        if (!request.componentId.has_value()) return missingField(request, "componentId");
        if (!request.port.has_value()) return missingField(request, "port");
        if (!simulation.has_value()) resetSimulation(circuit, simulation);

        const auto signal = simulation->signal({*request.componentId, *request.port});
        if (!signal.has_value()) {
            return protocol::errorResponse(request.requestId, "port_not_found", "找不到目标端口");
        }
        return responseWithId("signal_result", request.requestId) +
               ",\"value\":" + signalValueToJson(*signal) + "}";
    }

    return protocol::errorResponse(request.requestId, "unsupported_message", "不支持的消息类型");
}

}  // namespace circuit
