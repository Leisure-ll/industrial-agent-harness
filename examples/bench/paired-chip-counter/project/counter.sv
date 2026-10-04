module counter(input logic clk, rst, enable, output logic [3:0] count);
  always_ff @(posedge clk) begin
    if (rst) count <= 0;
    else count <= count + 1;
  end
endmodule
